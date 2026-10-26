import { median, type ActionSample } from './coaching.ts'
import { isCleanSpeed } from './samples.ts'
import { COACHING } from './types.ts'
import type { RunSummary } from './review.ts'

/** Home-row order, left pinky across to right pinky. Thumbs are not part of speed. */
export const FINGER_TARGETS = [
  'left:pinky',
  'left:ring',
  'left:middle',
  'left:index',
  'right:index',
  'right:middle',
  'right:ring',
  'right:pinky',
] as const

export type FingerBar = {
  target: (typeof FINGER_TARGETS)[number]
  /** Null until the finger has enough clean intervals to sit beside the others. */
  medianMs: number | null
  samples: number
}

export type ProgressPoint = {
  id: string
  startedAt: string
  wpm: number
  accuracy: number
}

export type SpeedFocus = {
  kind: 'finger' | 'bigram'
  target: string
}

export type FocusTracePoint = {
  id: string
  startedAt: string
  medianMs: number
}

export type Progress = {
  /** Measured tests, oldest first. Practice runs are not on this line. */
  points: ProgressPoint[]
  fingers: FingerBar[]
  runs: RunSummary[]
  /** The open focus, or the one that caught up while nothing else is open. */
  trace: (SpeedFocus & { points: FocusTracePoint[] }) | null
  /** Set when a newer focus has replaced one that caught up. */
  caughtUp: SpeedFocus | null
}

export function fingerBars(
  stats: readonly { target: string; medianMs: number; samples: number }[],
): FingerBar[] {
  const byTarget = new Map(stats.map((stat) => [stat.target, stat]))
  return FINGER_TARGETS.map((target) => {
    const stat = byTarget.get(target)
    if (!stat || stat.samples < COACHING.minFingerSamples) {
      return { target, medianMs: null, samples: stat?.samples ?? 0 }
    }
    return { target, medianMs: stat.medianMs, samples: stat.samples }
  })
}

export function focusTrace(
  attempts: readonly { sessionId: string; startedAt: string }[],
  actions: readonly ActionSample[],
  focus: SpeedFocus,
): FocusTracePoint[] {
  const bySession = new Map<string, number[]>()
  for (const action of actions) {
    if (!isCleanSpeed(action) || !matchesFocus(action, focus)) continue
    const bucket = bySession.get(action.sessionId) ?? []
    bucket.push(action.ikiMs)
    bySession.set(action.sessionId, bucket)
  }
  const ordered = [...attempts].sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.sessionId.localeCompare(b.sessionId),
  )
  const points: FocusTracePoint[] = []
  for (const attempt of ordered) {
    const medianMs = median(bySession.get(attempt.sessionId) ?? [])
    if (medianMs == null) continue
    points.push({ id: attempt.sessionId, startedAt: attempt.startedAt, medianMs })
  }
  return points
}

export function caughtUpLine(focus: SpeedFocus): string {
  if (focus.kind === 'bigram') return `"${focus.target}" caught up.`
  return `${focus.target.replace(':', ' ')} caught up.`
}

function matchesFocus(action: ActionSample, focus: SpeedFocus): boolean {
  if (focus.kind === 'bigram') return action.bigram === focus.target
  return action.hand != null && action.finger != null && `${action.hand}:${action.finger}` === focus.target
}
