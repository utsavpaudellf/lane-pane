// The slice of `lane dashboard`'s /api/state snapshot the pane draws.
export type LaneNext = {
  where: string
  step: string
  phase: string
  gate: boolean
  reason: string
  hint: string
}

export type LaneGate = { id: string; label: string; path: string; stale: boolean; notes: number; blocked: string | null }

// A passage the note points at, as lane's /api/review takes it: 1-based FILE lines and the text there.
export type LaneAnchor = { lineStart: number; lineEnd: number; quote: string }

export type LaneChoice = 'approve' | 'changes' | 'reject'

// The gate document the person opened in the pane, and what they are doing with it.
export type LaneReview = {
  gateId: string
  label: string
  path: string
  sha256: string // hash of the body shown; approve sends it, so an edited doc is refused
  body: string
  approvable: boolean
  lineOffset: number | null // frontmatter lines above the body; null from a lane too old to anchor notes
  context: LaneAnchor | null // the section the note is about; null = the whole document
  note: string
  choice: LaneChoice | null // picked with one press, sent with Confirm: every decision takes two presses
  busy: boolean
  result: { ok: boolean; message: string } | null
}

export type LaneView = {
  repo: string
  branch: string
  url: string
  next: LaneNext | null
  feature: string
  steps: { label: string; state: string }[]
  gates: LaneGate[]
  features: { dir: string; kind: string; step: string; landed: number; total: number }[]
  feed: { type: string; subject: string; ts: number }[]
  notices: string[]
}

export type LaneStatus =
  | { phase: 'idle' }
  | { phase: 'starting'; cwd: string }
  | { phase: 'live'; cwd: string }
  | { phase: 'error'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'lane-pane': { view: LaneView | null; status: LaneStatus; review: LaneReview | null }
  }
}
