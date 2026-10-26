import { isCleanSpeed } from './samples.ts'
import { COACHING, type CoachingSummary, type DrillKind } from './types.ts'

export type Attempt = {
  sessionId: string
  startedAt: string
  mode: 'words' | 'time' | 'drill'
  completed: boolean
}

/** A commit the coaching query loaded. Pauses and repairs are still here, and then ignored. */
export type ActionSample = {
  sessionId: string
  kind: 'commit' | 'backspace' | 'reject'
  outcome: string
  bigram: string | null
  hand: string | null
  finger: string | null
  ikiMs: number | null
  isHesitation: boolean
  afterError: boolean
}

export type OpenFocus = {
  id: string | null
  kind: DrillKind
  target: string
  openedAt: string
  baselineMedianMs: number
  baselineSamples: number
}

export type CloseReason = 'improved' | 'settled' | 'stale'

export type FingerStat = {
  target: string
  samples: number
  medianMs: number
  errorRate: number
}

export type BigramStat = {
  bigram: string
  samples: number
  medianMs: number
  errorRate: number
}

export type CoachingResult = {
  sentence: string | null
  tests: number
  focus: OpenFocus | null
  closed: { kind: DrillKind; target: string; reason: CloseReason } | null
  fingers: FingerStat[]
  bigrams: BigramStat[]
}

type Rated = {
  kind: DrillKind
  target: string
  samples: number
  medianMs: number
  refMedian: number
  refSamples: number
  ratio: number
  gap: number
  errorRate: number
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid]
  if (upper === undefined) return null
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1]
  if (lower === undefined) return upper
  return (lower + upper) / 2
}

export function focusLabel(focus: { kind: DrillKind; target: string }): string {
  if (focus.kind === 'bigram') return focus.target
  return focus.target.replace(':', ' ')
}

export function toCoachingSummary(result: CoachingResult): CoachingSummary {
  return {
    sentence: result.sentence,
    tests: result.tests,
    focus: result.focus ? { kind: result.focus.kind, target: result.focus.target } : null,
  }
}

function ms(value: number): string {
  return `${Math.round(value)} ms`
}

function sentenceFor(layoutName: string, rated: Rated): string {
  if (rated.kind === 'bigram') {
    return `On ${layoutName}, "${rated.target}" is holding you back. ${ms(rated.medianMs)} between those letters, against ${ms(rated.refMedian)} for your other pairs.`
  }
  const name = rated.target.replace(':', ' ')
  return `On ${layoutName}, your ${name} is slowing you down. ${ms(rated.medianMs)} between keys, against ${ms(rated.refMedian)} for your other fingers.`
}

export function caughtUpSentence(layoutName: string, kind: DrillKind, target: string): string {
  if (kind === 'bigram') {
    return `On ${layoutName}, "${target}" has caught up. Nothing else stands out yet.`
  }
  return `On ${layoutName}, your ${target.replace(':', ' ')} has caught up. Nothing else stands out yet.`
}

function minimum(kind: DrillKind): number {
  return kind === 'finger' ? COACHING.minFingerSamples : COACHING.minBigramSamples
}

export function coach(input: {
  attempts: readonly Attempt[]
  actions: readonly ActionSample[]
  openFocus: OpenFocus | null
  layoutName: string
  measurementTests: number
  nowIso: string
  trailingSessions?: number
}): CoachingResult {
  const trailing = input.trailingSessions ?? COACHING.trailingSessions
  const windowed = input.attempts
    .filter((attempt) => attempt.completed && attempt.mode !== 'drill')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.sessionId.localeCompare(b.sessionId))
    .slice(-trailing)
  const ids = new Set(windowed.map((attempt) => attempt.sessionId))
  const actions = input.actions.filter((action) => ids.has(action.sessionId))

  const fingerSpeed = new Map<string, number[]>()
  const fingerCorrect = new Map<string, number>()
  const fingerIncorrect = new Map<string, number>()
  const bigramSpeed = new Map<string, number[]>()
  const bigramCorrect = new Map<string, number>()
  const bigramIncorrect = new Map<string, number>()

  for (const action of actions) {
    if (action.kind !== 'commit') continue
    if (action.isHesitation) continue
    if (action.outcome !== 'correct' && action.outcome !== 'incorrect') continue

    if (action.finger && action.finger !== 'thumb' && action.hand && action.hand !== 'thumb') {
      const target = `${action.hand}:${action.finger}`
      if (action.outcome === 'incorrect') fingerIncorrect.set(target, (fingerIncorrect.get(target) ?? 0) + 1)
      else fingerCorrect.set(target, (fingerCorrect.get(target) ?? 0) + 1)
      if (isCleanSpeed(action)) {
        const bucket = fingerSpeed.get(target) ?? []
        bucket.push(action.ikiMs)
        fingerSpeed.set(target, bucket)
      }
    }

    if (action.bigram) {
      if (action.outcome === 'incorrect') bigramIncorrect.set(action.bigram, (bigramIncorrect.get(action.bigram) ?? 0) + 1)
      else bigramCorrect.set(action.bigram, (bigramCorrect.get(action.bigram) ?? 0) + 1)
      if (isCleanSpeed(action)) {
        const bucket = bigramSpeed.get(action.bigram) ?? []
        bucket.push(action.ikiMs)
        bigramSpeed.set(action.bigram, bucket)
      }
    }
  }

  const fingers = statsFrom(fingerSpeed, fingerCorrect, fingerIncorrect).map((stat) => ({
    target: stat.target,
    samples: stat.samples,
    medianMs: stat.medianMs,
    errorRate: stat.errorRate,
  }))
  const bigrams = statsFrom(bigramSpeed, bigramCorrect, bigramIncorrect).map((stat) => ({
    bigram: stat.target,
    samples: stat.samples,
    medianMs: stat.medianMs,
    errorRate: stat.errorRate,
  }))

  const rated = [
    ...rate('finger', fingerSpeed, fingerCorrect, fingerIncorrect),
    ...rate('bigram', bigramSpeed, bigramCorrect, bigramIncorrect),
  ]
  const qualifiers = rated
    .filter((item) => item.samples >= minimum(item.kind) && item.refSamples >= COACHING.minReferenceSamples)
    .filter((item) => item.ratio >= COACHING.slowRatio && item.gap >= COACHING.minGapMs)
    .sort(
      (a, b) =>
        b.ratio - a.ratio ||
        b.samples - a.samples ||
        (a.kind === b.kind ? 0 : a.kind === 'finger' ? -1 : 1) ||
        a.target.localeCompare(b.target),
    )

  const open = input.openFocus
  let closed: CoachingResult['closed'] = null
  let focus: OpenFocus | null = open

  if (open) {
    const decision = judge(open, rated)
    if (decision === 'keep') {
      const current = rated.find((item) => item.kind === open.kind && item.target === open.target)
      return {
        sentence: current ? sentenceFor(input.layoutName, current) : null,
        tests: input.measurementTests,
        focus: open,
        closed: null,
        fingers,
        bigrams,
      }
    }
    closed = { kind: open.kind, target: open.target, reason: decision }
    focus = null
  }

  const next = qualifiers.find((item) => !closed || item.kind !== closed.kind || item.target !== closed.target)
  if (next) {
    focus = {
      id: null,
      kind: next.kind,
      target: next.target,
      openedAt: input.nowIso,
      baselineMedianMs: next.medianMs,
      baselineSamples: next.samples,
    }
  }

  let sentence: string | null = null
  if (focus) {
    const current = rated.find((item) => item.kind === focus?.kind && item.target === focus.target)
    sentence = current ? sentenceFor(input.layoutName, current) : null
  } else if (closed?.reason === 'improved') {
    sentence = caughtUpSentence(input.layoutName, closed.kind, closed.target)
  }

  return { sentence, tests: input.measurementTests, focus, closed, fingers, bigrams }
}

function statsFrom(
  speed: Map<string, number[]>,
  correct: Map<string, number>,
  incorrect: Map<string, number>,
): { target: string; samples: number; medianMs: number; errorRate: number }[] {
  const keys = new Set([...speed.keys(), ...correct.keys(), ...incorrect.keys()])
  const stats = []
  for (const target of keys) {
    const samples = speed.get(target) ?? []
    const medianMs = median(samples)
    if (medianMs == null) continue
    const good = correct.get(target) ?? 0
    const bad = incorrect.get(target) ?? 0
    const total = good + bad
    stats.push({
      target,
      samples: samples.length,
      medianMs,
      errorRate: total > 0 ? bad / total : 0,
    })
  }
  return stats.sort((a, b) => b.medianMs - a.medianMs || a.target.localeCompare(b.target))
}

function rate(
  kind: DrillKind,
  speed: Map<string, number[]>,
  correct: Map<string, number>,
  incorrect: Map<string, number>,
): Rated[] {
  const rated: Rated[] = []
  for (const [target, samples] of speed) {
    const medianMs = median(samples)
    if (medianMs == null) continue
    // Pooled reference is every other group's intervals, not a median of medians.
    const refValues: number[] = []
    for (const [other, values] of speed) {
      if (other === target) continue
      refValues.push(...values)
    }
    const refMedian = median(refValues)
    if (refMedian == null || refMedian <= 0) continue
    const good = correct.get(target) ?? 0
    const bad = incorrect.get(target) ?? 0
    const total = good + bad
    rated.push({
      kind,
      target,
      samples: samples.length,
      medianMs,
      refMedian,
      refSamples: refValues.length,
      ratio: medianMs / refMedian,
      gap: medianMs - refMedian,
      errorRate: total > 0 ? bad / total : 0,
    })
  }
  return rated
}

function judge(open: OpenFocus, rated: readonly Rated[]): 'keep' | CloseReason {
  const current = rated.find((item) => item.kind === open.kind && item.target === open.target)
  if (!current || current.samples < minimum(open.kind)) return 'stale'
  if (current.refSamples < COACHING.minReferenceSamples) return 'keep'
  if (current.ratio >= COACHING.slowRatio && current.gap >= COACHING.minGapMs) return 'keep'
  if (current.medianMs < open.baselineMedianMs) return 'improved'
  return 'settled'
}
