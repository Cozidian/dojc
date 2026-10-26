export const ENGINE_VERSION = '1'
export const WORDLIST_VERSION = 'en-1'
export const LANGUAGE_ID = 'en' as const
export const GEOMETRY_ID = 'ansi' as const

/** A gap this long is a pause, not a slow finger. */
export const HESITATION_MS = 1500

/**
 * Time tests are accepted when the last event lands in the final 10% of the clock.
 * The clock itself, not the span between keys, is the duration used for WPM.
 */
export const TIME_SUBMIT_RATIO = 0.9

export const COACHING = {
  trailingSessions: 40,
  minFingerSamples: 25,
  minBigramSamples: 8,
  minReferenceSamples: 20,
  slowRatio: 1.35,
  minGapMs: 25,
} as const

/** How often a letter or word has to be missed before it is called a habit. */
export const MISSES = {
  trailingSessions: 40,
  letterMinAttempts: 15,
  letterMinMisses: 3,
  wordMinAttempts: 3,
  wordMinMisses: 2,
  limit: 5,
} as const

/** A finger drill keeps words where at least this share of letters use that finger. */
export const FINGER_DRILL_MIN_FRACTION = 1 / 3

export type LanguageId = typeof LANGUAGE_ID
export type GeometryId = typeof GEOMETRY_ID
export type LayoutId = 'qwerty-ansi' | 'dvorak-ansi'
export type Hand = 'left' | 'right' | 'thumb'
export type Finger = 'pinky' | 'ring' | 'middle' | 'index' | 'thumb'
export type TestMode = 'words' | 'time' | 'drill'
export type CorrectionPolicy = 'must_fix'
export type DrillKind = 'bigram' | 'finger' | 'letter' | 'word'

export type Drill = {
  kind: DrillKind
  /** `bl`, `left:pinky`, `e`, or `finally`. */
  target: string
}

export type TestSpec = {
  languageId: LanguageId
  layoutId: LayoutId
  mode: TestMode
  /** Word count, or seconds when mode is `time`. */
  modeValue: number
  seed: string
  drill: Drill | null
  correctionPolicy: CorrectionPolicy
}

export type InputEvent = {
  /** Milliseconds from the client clock origin. Intervals use this, never wall time. */
  tMs: number
  type: 'down' | 'up'
  /** Physical key, `KeyboardEvent.code`. Layouts map this; the OS character is not trusted. */
  code: string
  key: string
  shift: boolean
  shortcut: boolean
}

export type ActionKind = 'commit' | 'backspace' | 'reject'

export type ActionOutcome =
  | 'correct'
  | 'incorrect'
  | 'extra'
  | 'deleted_correct'
  | 'deleted_incorrect'
  | 'deleted_extra'
  | 'rejected_space'

export type Action = {
  seq: number
  tMs: number
  kind: ActionKind
  outcome: ActionOutcome
  expectedChar: string | null
  producedChar: string | null
  wordIndex: number
  charIndex: number | null
  word: string
  /** Expected in-word pair ending on this character. Null at a word start and for extras. */
  bigram: string | null
  code: string | null
  hand: Hand | null
  finger: Finger | null
  shift: boolean
  /** Keydown minus the previous action keydown. */
  ikiMs: number | null
  /** Keyup minus keydown. Null when the key is still held at the end of the log. */
  holdMs: number | null
  /** This keydown minus the previous action key's keyup. Negative means the keys overlapped. */
  flightMs: number | null
  isHesitation: boolean
  /** The previous action was a mistake or a repair, so this key is not natural speed. */
  afterError: boolean
}

export type SessionResult = {
  engineVersion: string
  wordlistVersion: string
  spec: TestSpec
  words: string[]
  targetText: string
  events: InputEvent[]
  actions: Action[]
  completed: boolean
  durationMs: number
  wpm: number
  rawWpm: number
  accuracy: number
  /** 0–100, higher is steadier. Null until there are enough clean intervals. */
  consistency: number | null
  correctChars: number
  incorrectChars: number
  extraChars: number
  backspaces: number
}

export type SaveSessionRequest = {
  engineVersion: string
  wordlistVersion: string
  spec: TestSpec
  events: InputEvent[]
  startedAt: string
}

export type CoachingSummary = {
  sentence: string | null
  tests: number
  focus: { kind: DrillKind; target: string } | null
}

export type SaveSessionResponse = {
  id: string
  wpm: number
  rawWpm: number
  accuracy: number
  consistency: number | null
  coaching: CoachingSummary
}

export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}
