/**
 * A clean interval is a correct letter typed in stride.
 * Pauses, repairs, spaces, and mistakes stay in the log and stay out of speed comparisons.
 */
export type SpeedSample = {
  kind: string
  outcome: string
  finger: string | null
  isHesitation: boolean
  afterError: boolean
  ikiMs: number | null
}

export function isCleanSpeed(sample: SpeedSample): sample is SpeedSample & { ikiMs: number } {
  return (
    sample.kind === 'commit' &&
    sample.outcome === 'correct' &&
    !sample.isHesitation &&
    !sample.afterError &&
    sample.ikiMs != null &&
    sample.finger != null &&
    sample.finger !== 'thumb'
  )
}
