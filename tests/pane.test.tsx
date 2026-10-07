import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SNAPSHOT = {
  repo: 'repo',
  branch: 'master',
  context: { feature: '0009-patch-undo', task: null },
  next: {
    feature: '0009-patch-undo',
    task: null,
    step: 'approve-spec',
    phase: 'SPEC',
    gate: true,
    reason: 'patch SPEC present; not yet approved',
    hint: 'Human gate - run: lane approve',
  },
  features: [
    {
      dir: '0009-patch-undo',
      kind: 'patch',
      step: { step: 'approve-spec' },
      steps: [
        { label: 'Fill SPEC.md', state: 'done' },
        { label: 'Human gate -> lane approve', state: 'now' },
      ],
      artifacts: { tasks: { total: 1, landed: 0 } },
    },
  ],
  gates: [{ id: 'spec:0009', label: 'Patch Spec - 0009-patch-undo', path: 'docs/features/0009/SPEC.md', stale: false, notes: 0, blocked: null }],
  feed: [{ type: 'scaffold', subject: 'chore(0009): patch scaffold', ts: 0 }],
  versionNotice: null,
  driftNotice: { stamp: '0.8.1', running: '0.9.0' },
}

const PANE = {
  component: 'Pane',
  requestId: 'lane',
  props: { title: 'LANE', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// The engine's pane list, faked beneath the plugin: open adds, close removes.
function mockPanes(on: On, closed: string[] = []) {
  const open = new Set<string>()
  on('ui.open', async ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async ($, e) => {
    open.delete(e.id)
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: [...open].map(id => ({ id, title: 'LANE', isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.surfaces', async () => ({ value: ['terminal' as const] }))
}

const RUN = { command: 'lane-pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } } as const

test('the pane draws the dashboard state on terminal and desktop', async ($, on) => {
  const clock = mock.clock(on)
  const spawned: string[][] = []
  on('process.spawn', async function* ($, e, next) {
    spawned.push([...e.argv, `cwd=${e.cwd}`])
    yield { stream: 'stdout', text: '  LANE dashboard → http://127.0.0.1:5555/#t=tok-1\n' }
    await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  const fetched: string[] = []
  on('http.fetch', async ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(SNAPSHOT) } }
  })
  const closed: string[] = []
  mockPanes(on, closed)
  mockFolders(on, '/', [], [])

  const ran = await $.command.run({ ...RUN, args: '/repos/try-it' })
  expect(ran.text).toContain('/repos/try-it')
  expect(ran.text).toContain('/tui fullscreen') // RUN is the main screen, so the tip shows
  await clock.settle()

  expect(spawned).toEqual([['lane', 'dashboard', '--no-open', 'cwd=/repos/try-it']])
  expect(fetched).toContain('http://127.0.0.1:5555/api/state')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'lane-pane', surface, ...PANE })
    expect(await ui.find({ text: /HUMAN GATE/ })).toBeDefined()
    expect(await ui.find({ text: /approve-spec/ })).toBeDefined()
    expect(await ui.find({ text: /Human gate -> lane approve/ })).toBeDefined()
    expect(await ui.find({ text: /run lane upgrade/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: 'Open full dashboard' })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: '⚑' })).toBeDefined() // glyph icons, not empty Svg
    await ui.unmount()
  }

  // Polling picks up a new snapshot.
  SNAPSHOT.next.step = 'start-task'
  await clock.advance(2000)
  const ui = await $.ui.mount({ plugin: 'lane-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /start-task/ })).toBeDefined()
  await ui.unmount()

  // A bare /lane-pane while the pane is open closes it.
  const toggled = await $.command.run({ ...RUN, args: '' })
  expect(toggled.text).toBe('LANE pane closed.')
  expect(closed).toEqual(['lane'])
})

test('the pane shows why lane dashboard did not start', async ($, on) => {
  const clock = mock.clock(on)
  on('process.spawn', async function* () {
    yield { stream: 'stderr', text: 'not a LANE repo — run: lane init\n' }
    return { value: { code: 1, signal: null } }
  })
  mockPanes(on)
  mockFolders(on, '/', [], [])

  await $.command.run({ ...RUN, args: '/not-lane' })
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'lane-pane', surface: 'desktop', ...PANE })
  expect(await ui.find({ text: /lane dashboard exited: not a LANE repo/ })).toBeDefined()
  await ui.unmount()
})

test('the pane falls back to lane-lite when lane does not start, and says when neither does', async ($, on) => {
  const clock = mock.clock(on)
  const tried: string[] = []
  let installed = ['lane-lite']
  on('process.spawn', async function* ($, e, next) {
    const bin = e.argv[0] ?? ''
    tried.push(bin)
    if (!installed.includes(bin)) throw new Error(`ENOENT: Executable not found in $PATH: "${bin}"`)
    yield { stream: 'stdout', text: '  LANE dashboard → http://127.0.0.1:5555/#t=tok-1\n' }
    await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(SNAPSHOT) } }))
  mockPanes(on)
  mockFolders(on, '/', [], [])

  await $.command.run({ ...RUN, args: '/repos/try-it' })
  await clock.settle()
  expect(tried).toEqual(['lane', 'lane-lite'])
  let ui = await $.ui.mount({ plugin: 'lane-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /live/ })).toBeDefined()
  await ui.unmount()

  installed = []
  await $.command.run({ ...RUN, args: '/repos/try-it' })
  await clock.settle()
  ui = await $.ui.mount({ plugin: 'lane-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /could not start lane or lane-lite dashboard/ })).toBeDefined()
  expect(tried).toEqual(['lane', 'lane-lite', 'lane', 'lane-lite'])
  await ui.unmount()
})

// A fake file system: `lanes` are the folders that hold `.lane/`.
function mockFolders(on: On, cwd: string, children: string[], lanes: string[]) {
  on('session.cwd', async () => ({ value: cwd }))
  on('fs.exists', async ($, e) => ({ value: lanes.some(l => e.path === `${l}/.lane`) }))
  on('fs.list', async ($, e) => ({
    value: e.path === cwd ? children.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) : [],
  }))
}

test('a bare /lane-pane finds the lane repo in the session folder, above it, or one level down', async ($, on) => {
  const spawned: string[] = []
  on('process.spawn', async function* ($, e) {
    spawned.push(e.cwd ?? '')
    return { value: { code: 1, signal: null } }
  })
  mockPanes(on)

  mockFolders(on, '/work/try-it', ['.git', 'notes', 'repo'], ['/work/try-it/repo'])
  const ran = await $.command.run({ ...RUN, args: '' })
  expect(ran.text).toContain('LANE pane opened for /work/try-it/repo.')
  expect(spawned).toEqual(['/work/try-it/repo'])
})

test('a bare /lane-pane uses the repo root from a subfolder', async ($, on) => {
  const spawned: string[] = []
  on('process.spawn', async function* ($, e) {
    spawned.push(e.cwd ?? '')
    return { value: { code: 1, signal: null } }
  })
  mockPanes(on)
  mockFolders(on, '/work/repo/docs', [], ['/work/repo'])
  await $.command.run({ ...RUN, args: '' })
  expect(spawned).toEqual(['/work/repo'])
})

test('with several lane repos below, /lane-pane lists them and opens nothing', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', async () => ({ value: [] }))
  mockFolders(on, '/work', ['a', 'b'], ['/work/a', '/work/b'])
  const ran = await $.command.run({ ...RUN, args: '' })
  expect(ran.text).toContain('Found 2 lane repos in /work:\n- /work/a\n- /work/b')
  expect(opened).toEqual([])
})

// A fake dashboard beneath the plugin: state, the gate's doc, and the two POST routes.
function mockDashboard(on: On, posts: { url: string; body: Record<string, unknown> }[]) {
  mockFolders(on, '/', [], [])
  on('process.spawn', async function* ($, e, next) {
    yield { stream: 'stdout', text: '  LANE dashboard → http://127.0.0.1:5555/#t=tok-1\n' }
    await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  on('http.fetch', async ($, e) => {
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (e.url.endsWith('/api/state')) return reply(SNAPSHOT)
    if (e.url.includes('/api/doc?path=')) {
      return reply({ body: '# Patch 0009\n\nUndo the last cart line removal.', sha256: 'abc123def456789', gateId: 'spec:0009', approvable: true })
    }
    posts.push({ url: e.url, body: JSON.parse(e.init?.body ?? '{}') as Record<string, unknown> })
    return reply({ ok: true, message: 'Patch Spec approved — stamp written by lane (utsav).' })
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`approve needs two presses and sends the token and the sha256 of the text shown (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    const posts: { url: string; body: Record<string, unknown> }[] = []
    mockDashboard(on, posts)
    mockPanes(on)
    await $.command.run({ ...RUN, args: '/repos/try-it' })
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'lane-pane', surface, ...PANE })
    await ui.press({ key: 'review-spec:0009' })
    await clock.settle()
    expect(await ui.find({ type: 'Markdown', text: /Undo the last cart line removal/ })).toBeDefined()

    await ui.press({ key: 'approve' })
    expect(posts).toEqual([]) // first press only arms
    expect(await ui.find({ key: 'approve', text: /Confirm/ })).toBeDefined()

    await ui.press({ key: 'approve' })
    await clock.settle()
    expect(posts).toEqual([{ url: 'http://127.0.0.1:5555/api/approve', body: { token: 'tok-1', gateId: 'spec:0009', sha256: 'abc123def456789' } }])
    expect(await ui.find({ key: 'approve' })).toBeUndefined() // back on the dashboard
    expect(await ui.find({ text: /Waiting on you/ })).toBeDefined()
    await ui.unmount()
  })

  test(`request changes needs a note; reject does not (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    const posts: { url: string; body: Record<string, unknown> }[] = []
    mockDashboard(on, posts)
    mockPanes(on)
    await $.command.run({ ...RUN, args: '/repos/try-it' })
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'lane-pane', surface, ...PANE })
    await ui.press({ key: 'review-spec:0009' })
    await clock.settle()
    await ui.press({ key: 'changes' })
    expect(posts).toEqual([])
    expect(await ui.find({ text: /Add a note first/ })).toBeDefined()

    await ui.input({ key: 'note', text: 'Keep the undo for 10 seconds', kind: 'change' })
    await ui.press({ key: 'changes' })
    await clock.settle()
    expect(posts[0]).toEqual({
      url: 'http://127.0.0.1:5555/api/review',
      body: { token: 'tok-1', gateId: 'spec:0009', sha256: 'abc123def456789', verdict: 'changes', note: 'Keep the undo for 10 seconds' },
    })

    await ui.press({ key: 'review-spec:0009' })
    await clock.settle()
    await ui.press({ key: 'reject' })
    await clock.settle()
    expect(posts[1]?.body).toEqual({ token: 'tok-1', gateId: 'spec:0009', sha256: 'abc123def456789', verdict: 'reject', note: '' })
    await ui.unmount()
  })
}
