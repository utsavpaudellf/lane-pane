import type { Elements, RenderElement } from 'claude-code'

import type { LaneGate, LaneReview, LaneStatus, LaneView } from '../types'

// What the person's presses do; register.tsx owns the effects.
export type PaneActions = {
  stop: () => void
  open: (gate: LaneGate) => void
  back: () => void
  note: (text: string) => void
  approve: () => void
  review: (verdict: 'changes' | 'reject') => void
}

// Markdown takes at most 10,000 characters, so a long document is drawn in line-aligned chunks.
function chunks(body: string, max = 9000): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of body.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n${line}` : line.slice(0, max)
  }
  if (cur) out.push(cur)
  return out
}

// The pane's drawing. Desktop gets SVG icons; the terminal gets one colored glyph per icon.
type Els = Elements[keyof Elements]

const HEX = { green: '#30a46c', yellow: '#e5a000', red: '#e5484d', blue: '#3e8ef7', gray: '#8f8f8f', accent: '#d97757', magenta: '#8e4ec6' }
type Tone = keyof typeof HEX
// Text colors: named where the terminal palette has one, hex for the lane accent.
const TEXT: Record<Tone, string> = { green: 'green', yellow: 'yellow', red: 'red', blue: 'blue', gray: 'gray', accent: HEX.accent, magenta: 'magenta' }

const ICONS = {
  logo: { glyph: '◆', tone: 'accent', svg: `<rect x="1" y="1" width="22" height="22" rx="6" fill="${HEX.accent}"/><path d="M9 5v14M15 5v14" stroke="#fff" stroke-width="2.2" stroke-dasharray="3 2.5"/>` },
  done: { glyph: '✔', tone: 'green', svg: `<circle cx="12" cy="12" r="10" fill="${HEX.green}"/><path d="m7.5 12.5 3 3 6-6.5" stroke="#fff" stroke-width="2.5"/>` },
  now: { glyph: '◉', tone: 'accent', svg: `<circle cx="12" cy="12" r="10" fill="${HEX.accent}" fill-opacity=".25"/><circle cx="12" cy="12" r="5" fill="${HEX.accent}"/>` },
  todo: { glyph: '○', tone: 'gray', svg: `<circle cx="12" cy="12" r="8.5" stroke="${HEX.gray}" stroke-width="2" stroke-dasharray="3 3"/>` },
  gate: { glyph: '⚑', tone: 'yellow', svg: `<circle cx="12" cy="12" r="11" fill="${HEX.yellow}"/><circle cx="12" cy="9" r="3.2" fill="#fff"/><path d="M6.5 18c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5z" fill="#fff"/>` },
  next: { glyph: '➜', tone: 'blue', svg: `<circle cx="12" cy="12" r="11" fill="${HEX.blue}"/><path d="M7.5 12h9m-4-4.5 4.5 4.5-4.5 4.5" stroke="#fff" stroke-width="2.2"/>` },
  warn: { glyph: '⚠', tone: 'yellow', svg: `<path d="M12 2.5 1.8 20.5h20.4z" fill="${HEX.yellow}"/><path d="M12 9v5" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="17.2" r="1.3" fill="#fff"/>` },
  branch: { glyph: '⎇', tone: 'gray', svg: `<g stroke="${HEX.gray}" stroke-width="2"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M6 7.2v9.6M18 8.2c0 5-12 3.5-12 8.6"/></g>` },
  note: { glyph: '✎', tone: 'gray', svg: `<path d="M4 5h16v11H9l-5 4z" stroke="${HEX.gray}" stroke-width="2"/>` },
  stale: { glyph: '◷', tone: 'yellow', svg: `<circle cx="12" cy="12" r="9" stroke="${HEX.yellow}" stroke-width="2"/><path d="M12 7v5l3 2" stroke="${HEX.yellow}" stroke-width="2"/>` },
  steps: { glyph: '☰', tone: 'gray', svg: `<path d="M9 6h11M9 12h11M9 18h11" stroke="${HEX.gray}" stroke-width="2"/><circle cx="4.5" cy="6" r="1.5" fill="${HEX.gray}"/><circle cx="4.5" cy="12" r="1.5" fill="${HEX.gray}"/><circle cx="4.5" cy="18" r="1.5" fill="${HEX.gray}"/>` },
  features: { glyph: '▣', tone: 'gray', svg: `<path d="m12 3 9 5-9 5-9-5z" stroke="${HEX.gray}" stroke-width="2"/><path d="m3 13 9 5 9-5" stroke="${HEX.gray}" stroke-width="2"/>` },
  activity: { glyph: '∿', tone: 'gray', svg: `<path d="M3 12h4l3-8 4 16 3-8h4" stroke="${HEX.gray}" stroke-width="2"/>` },
} as const satisfies Record<string, { glyph: string; tone: Tone; svg: string }>
type IconName = keyof typeof ICONS

const FEED_TONE: Record<string, Tone> = {
  red: 'red', green: 'green', refactor: 'blue', regression: 'red', approval: 'yellow',
  claim: 'blue', scaffold: 'accent', merge: 'magenta', commit: 'gray',
}
const KIND_TONE: Record<string, Tone> = { patch: 'magenta', feature: 'blue', enhancement: 'green' }
const PHASE_TONE: Record<string, Tone> = { SPEC: 'blue', PLAN: 'magenta', EXECUTE: 'accent', REVIEW: 'yellow', DONE: 'green' }

const svgDoc = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function drawPane(els: Els, surface: string, st: LaneStatus, v: LaneView | null, rv: LaneReview | null, act: PaneActions): RenderElement {
  const { Box, Text, Button, Link, Markdown } = els
  const Input = 'Input' in els ? els.Input : undefined
  // Not `'Svg' in els`: the terminal's table has Svg too, completed to an empty fragment.
  const Svg = surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined

  const icon = (name: IconName, size = 16) =>
    Svg ? <Svg alt={name} width={size} height={size} source={svgDoc(ICONS[name].svg)} /> : <Text color={TEXT[ICONS[name].tone]}>{ICONS[name].glyph}</Text>
  const dot = (tone: Tone) =>
    Svg ? <Svg alt="" width={10} height={10} source={svgDoc(`<circle cx="12" cy="12" r="7" fill="${HEX[tone]}"/>`)} /> : <Text color={TEXT[tone]}>●</Text>
  const badge = (text: string, tone: Tone) => (
    <Text backgroundColor={TEXT[tone]} color={tone === 'yellow' || tone === 'green' ? 'black' : 'white'} bold>
      {` ${text} `}
    </Text>
  )
  const bar = (done: number, total: number) => {
    const ratio = total > 0 ? done / total : 0
    if (Svg) {
      const w = Math.round(56 * ratio)
      return <Svg alt={`${done} of ${total}`} width={60} height={8} source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 8"><rect x="0" y="1" width="60" height="6" rx="3" fill="${HEX.gray}" fill-opacity=".3"/>${w > 0 ? `<rect x="0" y="1" width="${w + 4}" height="6" rx="3" fill="${HEX.green}"/>` : ''}</svg>`} />
    }
    const cells = Math.round(8 * ratio)
    return <Text><Text color="green">{'▰'.repeat(cells)}</Text><Text dimColor>{'▱'.repeat(8 - cells)}</Text></Text>
  }
  const row = (...children: (RenderElement | false)[]) => (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      {children}
    </Box>
  )
  const section = (name: IconName, title: string, body: RenderElement[], extra?: RenderElement) => (
    <Box flexDirection="column" gap={0}>
      {row(icon(name, 14), <Text bold>{title}</Text>, extra ?? false)}
      <Box flexDirection="column" paddingLeft={2}>{body}</Box>
    </Box>
  )

  if (st.phase === 'idle') return row(icon('logo'), <Text dimColor>Stopped. Run /lane-pane to start.</Text>)
  if (!v) {
    if (st.phase === 'error') return row(icon('warn'), <Text color="red" wrap="wrap">{st.message}</Text>)
    return row(icon('logo'), <Text dimColor>Starting lane dashboard in {st.cwd}…</Text>)
  }

  if (rv) {
    const verdictHelp = 'Request changes and Reject do not stamp anything. The agent gets your note and revises.'
    return (
      <Box flexDirection="column" gap={1}>
        {row(<Button key="back" label="Back" onPress={act.back} />, icon('gate', 16), <Text bold wrap="wrap">{rv.label}</Text>)}
        <Text dimColor wrap="truncate-middle">{rv.path} | sha256 {rv.sha256.slice(0, 12)}</Text>
        {rv.result && row(icon(rv.result.ok ? 'done' : 'warn', 14), <Text color={rv.result.ok ? 'green' : 'red'} wrap="wrap">{rv.result.message}</Text>)}
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          {chunks(rv.body).map(text => <Markdown text={text} />)}
        </Box>
        {!rv.approvable && row(icon('warn', 14), <Text color="yellow" wrap="wrap">Not approvable from the pane right now. Open the full dashboard to see why.</Text>)}
        {Input && (
          <Input key="note" label="Note for the agent" placeholder="What should change? (needed for Request changes)" value={rv.note} submitLabel="keep" onInput={act.note} onSubmit={act.note} />
        )}
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {rv.approvable && (
            <Button key="approve" variant="primary" label={rv.busy ? 'Sending...' : rv.armed ? 'Confirm: approve and stamp' : 'Approve'} onPress={act.approve} />
          )}
          <Button key="changes" label="Request changes" onPress={() => act.review('changes')} />
          <Button key="reject" label="Reject" onPress={() => act.review('reject')} />
        </Box>
        {rv.armed
          ? <Text color="yellow" wrap="wrap">Press Confirm to stamp {rv.path} as approved and commit it under your git name.</Text>
          : <Text dimColor wrap="wrap">Approve stamps and commits this exact text (the sha256 above). {verdictHelp}</Text>}
      </Box>
    )
  }

  const next = v.next
  const header = (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      {icon('logo', 28)}
      <Box flexDirection="column">
        <Text bold>{v.repo}</Text>
        {row(icon('branch', 12), <Text dimColor>{v.branch}</Text>, dot(st.phase === 'error' ? 'red' : 'green'), <Text dimColor>{st.phase === 'error' ? 'offline' : 'live'}</Text>)}
      </Box>
    </Box>
  )

  const notices = v.notices.map(n => (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="row" columnGap={1}>
      {icon('warn', 14)}
      <Text color="yellow" wrap="wrap">{n}</Text>
    </Box>
  ))

  const nextCard = next ? (
    <Box borderStyle="round" borderColor={next.gate ? 'yellow' : 'blue'} paddingX={1} flexDirection="column">
      {row(icon(next.gate ? 'gate' : 'next', 18), <Text bold>{next.step}</Text>, badge(next.phase, PHASE_TONE[next.phase] ?? 'gray'), next.gate && badge('HUMAN GATE', 'yellow'))}
      <Text dimColor wrap="truncate-end">{next.where}</Text>
      <Text wrap="wrap">{next.reason}</Text>
      <Text color={TEXT.accent} wrap="wrap">{next.hint}</Text>
    </Box>
  ) : (
    <Box borderStyle="round" borderColor="green" paddingX={1}>{row(icon('done', 18), <Text>Nothing in progress.</Text>)}</Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {header}
      {st.phase === 'error' && row(icon('warn', 14), <Text color="red" wrap="wrap">{st.message}</Text>)}
      {notices}
      {nextCard}

      {v.gates.length > 0 &&
        section('gate', 'Waiting on you', v.gates.map(g =>
          <Box flexDirection="column">
            {row(dot('yellow'), <Text wrap="wrap">{g.label}</Text>,
              g.stale && row(icon('stale', 12), <Text color="yellow">stale</Text>),
              g.notes > 0 && row(icon('note', 12), <Text dimColor>{g.notes}</Text>))}
            {g.blocked
              ? <Text color="yellow" wrap="wrap">  Blocked: {g.blocked}</Text>
              : <Box paddingLeft={2}><Button key={`review-${g.id}`} label="Review" variant="primary" onPress={() => act.open(g)} /></Box>}
          </Box>,
        ), badge(String(v.gates.length), 'yellow'))}

      {v.steps.length > 0 &&
        section('steps', 'Progress', v.steps.map(s =>
          row(icon(s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : 'todo', 14),
            <Text bold={s.state === 'now'} dimColor={s.state === 'todo'} wrap="truncate-end">{s.label}</Text>),
        ), <Text dimColor wrap="truncate-end">{v.feature}</Text>)}

      {v.features.length > 0 &&
        section('features', 'Features', v.features.map(f => (
          <Box flexDirection="column">
            {row(badge(f.kind, KIND_TONE[f.kind] ?? 'gray'), <Text wrap="truncate-end">{f.dir}</Text>)}
            {row(bar(f.landed, f.total), <Text dimColor>{f.landed}/{f.total} landed · {f.step}</Text>)}
          </Box>
        )))}

      {v.feed.length > 0 &&
        section('activity', 'Activity', v.feed.map(f =>
          row(dot(FEED_TONE[f.type] ?? 'gray'), <Text dimColor>{ago(f.ts).padStart(3)}</Text>, <Text wrap="truncate-end">{f.subject}</Text>),
        ))}

      <Box flexDirection="row" alignItems="center" columnGap={2}>
        <Link href={v.url.replace('http://127.0.0.1:', 'http://localhost:')} label="Open full dashboard" />
        <Button key="stop" label="Stop" onPress={act.stop} />
      </Box>
    </Box>
  )
}
