import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register, Timer } from 'claude-code'

import type { LaneGate, LaneReview, LaneStatus, LaneView } from '../types'
import { drawPane, type PaneActions } from './draw'

// The pane starts `lane dashboard --no-open`, draws its /api/state, and sends a person's
// gate decisions to its token-gated /api/approve and /api/review. The dashboard stays the
// single reader and writer of lane state, so the pane never stamps anything itself.
const PANE = 'lane'
const POLL_MS = 2000
const URL_LINE = /(http:\/\/127\.0\.0\.1:\d+)\/#t=([\w-]+)/

const view = atom({ plugin: 'lane-pane', key: 'view' } as const, null)
const status = atom({ plugin: 'lane-pane', key: 'status' } as const, { phase: 'idle' })
const review = atom({ plugin: 'lane-pane', key: 'review' } as const, null)

// The running dashboard. Module variables on purpose: a reload kills the child with them.
let child: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | null = null
let base = ''
let poll: Timer | null = null
let lastJson = ''
let liveCwd = ''
// The dashboard's session token. Only the person's button presses spend it; the model has
// no tool that reaches it.
let token = ''

type Snapshot = {
  repo: string
  branch: string
  context: { feature: string; task: string | null } | null
  next: { feature: string; task: string | null; step: string; phase: string; gate: boolean; reason: string; hint: string } | null
  features: { dir: string; kind: string; step: { step: string } | null; steps: { label: string; state: string }[]; artifacts: { tasks: { total: number; landed: number } } }[]
  gates: { id: string; label: string; path: string; stale: boolean; notes: number; blocked: string | null }[]
  feed: { type: string; subject: string; ts: number }[]
  versionNotice: { local: string; latest: string } | null
  driftNotice: { stamp: string; running: string } | null
}

const setStatus = ($: EngineInterface, next: LaneStatus) => update($, status, () => next)

function toView(s: Snapshot, url: string): LaneView {
  const featureDir = s.context?.feature ?? s.next?.feature ?? ''
  const feature = s.features.find(f => f.dir === featureDir)
  const notices: string[] = []
  if (s.driftNotice) notices.push(`.lane/ scaffolded by lane ${s.driftNotice.stamp}, running ${s.driftNotice.running}: run lane upgrade`)
  if (s.versionNotice) notices.push(`lane ${s.versionNotice.latest} is available (you have ${s.versionNotice.local})`)
  return {
    repo: s.repo,
    branch: s.branch,
    url,
    next: s.next && {
      where: s.next.task ?? s.next.feature,
      step: s.next.step,
      phase: s.next.phase,
      gate: s.next.gate,
      reason: s.next.reason,
      hint: s.next.hint,
    },
    feature: featureDir,
    steps: feature?.steps.map(({ label, state }) => ({ label, state })) ?? [],
    gates: s.gates.map(({ id, label, path, stale, notes, blocked }) => ({ id, label, path, stale, notes, blocked })),
    features: s.features.map(f => ({
      dir: f.dir,
      kind: f.kind,
      step: f.step?.step ?? 'done',
      landed: f.artifacts.tasks.landed,
      total: f.artifacts.tasks.total,
    })),
    feed: s.feed.slice(0, 6).map(({ type, subject, ts }) => ({ type, subject, ts })),
    notices,
  }
}

async function refresh($: EngineInterface): Promise<void> {
  if (!base) return
  try {
    const res = await $.http.fetch(`${base}/api/state`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (res.text === lastJson) return // ponytail: skip identical snapshots so the pane redraws only on change
    lastJson = res.text
    await update($, status, (s): LaneStatus => (s.phase === 'error' ? { phase: 'live', cwd: liveCwd } : s))
    await update($, view, () => toView(JSON.parse(res.text) as Snapshot, `${base}/#t=${token}`))
  } catch (err) {
    await setStatus($, { phase: 'error', message: `dashboard did not answer: ${String(err)}` })
  }
}

async function stop($: EngineInterface): Promise<void> {
  poll?.cancel()
  poll = null
  const running = child
  child = null
  base = ''
  token = ''
  lastJson = ''
  await update($, review, () => null)
  void running?.return(undefined as never) // ends the loop, which kills the child
  await setStatus($, { phase: 'idle' })
}

// Both editions serve the same dashboard; the first one that starts runs it.
const BINARIES = ['lane', 'lane-lite']

async function start($: EngineInterface, cwd: string, bins = BINARIES): Promise<void> {
  const [bin, ...rest] = bins
  if (!bin) return
  await stop($)
  await update($, view, () => null)
  await setStatus($, { phase: 'starting', cwd })
  const spawned = $.process.spawn({ argv: [bin, 'dashboard', '--no-open'], cwd })
  child = spawned
  liveCwd = cwd
  void (async () => {
    let out = ''
    try {
      for await (const { text } of spawned) {
        out = (out + text).slice(-4000)
        const m = base ? null : out.match(URL_LINE)
        if (!m) continue
        base = m[1] ?? ''
        token = m[2] ?? ''
        await setStatus($, { phase: 'live', cwd })
        await refresh($)
        poll = $.clock.every(POLL_MS, () => void refresh($))
      }
      if (child !== spawned) return // we stopped it
      const last = out.trim().split('\n').at(-1) ?? ''
      await stop($)
      await setStatus($, { phase: 'error', message: `${bin} dashboard exited: ${last.trim()}` })
    } catch (err) {
      if (child !== spawned) return
      if (!out && rest.length > 0) return start($, cwd, rest) // not installed: try the other edition
      await stop($)
      await setStatus($, { phase: 'error', message: `could not start lane dashboard: ${String(err)}` })
    }
  })()
}

// The lane repo for `dir`: `dir` or a folder above it with `.lane/`, else the one direct
// subfolder with `.lane/` (a session opened one level above the repo).
async function findRepos($: EngineInterface, dir: string): Promise<string[]> {
  for (let up = dir.replace(/\/+$/, ''); up; up = up.slice(0, up.lastIndexOf('/'))) {
    if (await $.fs.exists(`${up}/.lane`)) return [up]
  }
  const entries = await $.fs.list(dir).catch(() => [])
  const repos: string[] = []
  for (const { name, kind } of entries) {
    if (kind === 'dir' && !name.startsWith('.') && (await $.fs.exists(`${dir}/${name}/.lane`))) repos.push(`${dir.replace(/\/+$/, '')}/${name}`)
  }
  return repos // ponytail: one level down only; deeper layouts pass the path
}

const setReview = ($: EngineInterface, change: (r: LaneReview) => LaneReview) =>
  update($, review, r => (r ? change(r) : r))

async function post($: EngineInterface, route: string, payload: object): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await $.http.fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
    })
    const out = JSON.parse(res.text) as { ok?: boolean; message?: string }
    return { ok: out.ok === true, message: out.message ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, message: `dashboard did not answer: ${String(err)}` }
  }
}

// After a decision the gate leaves the snapshot: drop the cache so the next poll redraws.
async function closeReview($: EngineInterface, message: string): Promise<void> {
  $.ui.toast(message)
  await update($, review, () => null)
  lastJson = ''
  await refresh($)
}

function actionsFor($: EngineInterface): PaneActions {
  return {
    stop: () => void stop($),
    open: (gate: LaneGate) =>
      void (async () => {
        try {
          const res = await $.http.fetch(`${base}/api/doc?path=${encodeURIComponent(gate.path)}`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const doc = JSON.parse(res.text) as { body: string; sha256: string; gateId: string | null; approvable: boolean }
          await update($, review, () => ({
            gateId: doc.gateId ?? gate.id,
            label: gate.label,
            path: gate.path,
            sha256: doc.sha256,
            body: doc.body,
            approvable: doc.approvable,
            note: '',
            armed: false,
            busy: false,
            result: null,
          }))
        } catch (err) {
          $.ui.toast(`Could not open ${gate.path}: ${String(err)}`)
        }
      })(),
    back: () => void update($, review, () => null),
    note: (text: string) => void setReview($, r => ({ ...r, note: text })),
    approve: () =>
      void (async () => {
        const r = await read($, review)
        if (!r || r.busy || !r.approvable) return
        if (!r.armed) return void (await setReview($, x => ({ ...x, armed: true, result: null })))
        await setReview($, x => ({ ...x, busy: true }))
        const out = await post($, '/api/approve', { gateId: r.gateId, sha256: r.sha256 })
        if (out.ok) return closeReview($, out.message)
        await setReview($, x => ({ ...x, busy: false, armed: false, result: out }))
      })(),
    review: (verdict: 'changes' | 'reject') =>
      void (async () => {
        const r = await read($, review)
        if (!r || r.busy) return
        if (verdict === 'changes' && !r.note.trim()) {
          return void (await setReview($, x => ({ ...x, armed: false, result: { ok: false, message: 'Add a note first: the agent needs to know what to change.' } })))
        }
        await setReview($, x => ({ ...x, busy: true, armed: false }))
        const out = await post($, '/api/review', { gateId: r.gateId, sha256: r.sha256, verdict, note: r.note })
        if (out.ok) return closeReview($, out.message)
        await setReview($, x => ({ ...x, busy: false, result: out }))
      })(),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lane-pane',
      description: 'Toggle the LANE dashboard pane (optional: path to the lane repo)',
      argumentHint: '[repo-path]',
      immediate: true,
    })
    // A reload killed the old child with the old module: restart it for the pane still open.
    const st = await read($, status)
    if (st.phase === 'live' || st.phase === 'starting') await start($, st.cwd)
    return next(e)
  })

  on('command.run', { command: 'lane-pane' }, async ($, e) => {
    // Bare `/lane-pane` toggles; with a path it opens (or switches to) that repo.
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen && !e.args.trim()) {
      await $.ui.close({ id: PANE }) // ui.close below stops the dashboard
      return { text: 'LANE pane closed.' }
    }
    const asked = e.args.trim() || (await $.session.cwd())
    const repos = await findRepos($, asked)
    if (repos.length > 1) {
      return { text: `Found ${repos.length} lane repos in ${asked}:\n${repos.map(r => `- ${r}`).join('\n')}\nRun \`/lane-pane <path>\` with one of them.` }
    }
    const cwd = repos[0] ?? asked // none found: lane's own error shows in the pane
    await start($, cwd) // first, so the pane opens on "Starting" and not on "Stopped"
    await $.ui.open({ id: PANE, title: 'LANE', columns: 64 })
    const inTerminal = (await $.session.surfaces()).includes('terminal')
    const tip = inTerminal && !e.presentation.isFullscreen ? ' Run `/tui fullscreen` to dock it at the side.' : ''
    return { text: `LANE pane opened for ${cwd}.${tip}` }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) void stop($)
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    drawPane($.ui.resolve(e), e.surface, await read($, status), await read($, view), await read($, review), actionsFor($)),
  )
}
