import { fingerFor } from './geometry.ts'
import { charFor } from './layouts.ts'
import { isCleanSpeed } from './samples.ts'
import {
  ENGINE_VERSION,
  HESITATION_MS,
  TIME_SUBMIT_RATIO,
  WORDLIST_VERSION,
  InputError,
  type Action,
  type ActionOutcome,
  type InputEvent,
  type SaveSessionRequest,
  type SessionResult,
  type TestSpec,
} from './types.ts'
import { generateWords } from './words.ts'

type Held = { tMs: number; actionSeq: number | null }

export type EngineState = {
  spec: TestSpec
  words: readonly string[]
  wordIndex: number
  typed: string
  done: boolean
  events: InputEvent[]
  actions: Action[]
  held: Record<string, Held>
  lastActionT: number | null
  lastWasTrouble: boolean
  nextSeq: number
}

function assertEvent(event: InputEvent, previous: InputEvent | undefined): void {
  if (!Number.isFinite(event.tMs) || event.tMs < 0) throw new InputError('event time is invalid')
  if (previous && event.tMs < previous.tMs) throw new InputError('event time went backwards')
  if (event.type !== 'down' && event.type !== 'up') throw new InputError('bad event type')
  if (typeof event.code !== 'string' || event.code.length === 0 || event.code.length > 32) {
    throw new InputError('bad key code')
  }
  if (typeof event.key !== 'string' || event.key.length > 32) throw new InputError('bad key')
  if (typeof event.shift !== 'boolean' || typeof event.shortcut !== 'boolean') {
    throw new InputError('bad modifiers')
  }
}

export function createTest(spec: TestSpec, words?: readonly string[]): EngineState {
  const chosen = words ? [...words] : generateWords(spec)
  if (chosen.length === 0) throw new InputError('a test needs at least one word')
  for (const word of chosen) {
    if (!/^[a-z]+$/.test(word)) throw new InputError('words are lowercase letters')
  }
  return {
    spec,
    words: chosen,
    wordIndex: 0,
    typed: '',
    done: false,
    events: [],
    actions: [],
    held: {},
    lastActionT: null,
    lastWasTrouble: false,
    nextSeq: 0,
  }
}

export function applyEvent(state: EngineState, event: InputEvent): EngineState {
  assertEvent(event, state.events.at(-1))
  const next: EngineState = {
    ...state,
    events: [...state.events, event],
    actions: state.actions,
    held: { ...state.held },
    words: state.words,
  }

  if (event.type === 'up') return release(next, event)
  if (next.held[event.code]) return next
  if (next.done || event.shortcut || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    next.held[event.code] = { tMs: event.tMs, actionSeq: null }
    return next
  }

  const drafted = draftAction(next, event)
  if (!drafted) {
    next.held[event.code] = { tMs: event.tMs, actionSeq: null }
    return next
  }

  const action = drafted.action
  action.ikiMs = next.lastActionT == null ? null : event.tMs - next.lastActionT
  action.isHesitation = action.ikiMs != null && action.ikiMs >= HESITATION_MS
  action.afterError = next.lastWasTrouble
  next.typed = drafted.typed
  next.wordIndex = drafted.wordIndex
  next.done = drafted.done
  next.actions = [...next.actions, action]
  next.lastActionT = event.tMs
  next.lastWasTrouble = troubleAfter(action, next.typed, next.words[next.wordIndex] ?? '')
  next.held[event.code] = { tMs: event.tMs, actionSeq: action.seq }
  next.nextSeq = action.seq + 1
  return next
}

function release(state: EngineState, event: InputEvent): EngineState {
  const held = state.held[event.code]
  if (!held) return state
  const heldMap = { ...state.held }
  delete heldMap[event.code]
  state.held = heldMap
  if (held.actionSeq == null) return state

  const releasedSeq = held.actionSeq
  state.actions = state.actions.map((action) => {
    if (action.seq === releasedSeq) return { ...action, holdMs: event.tMs - held.tMs }
    if (action.seq === releasedSeq + 1 && action.flightMs == null) {
      return { ...action, flightMs: action.tMs - event.tMs }
    }
    return action
  })
  return state
}

function troubleAfter(action: Action, typed: string, word: string): boolean {
  if (action.outcome === 'correct' && (word.startsWith(typed) || action.expectedChar === ' ')) return false
  return true
}

type Draft = {
  action: Action
  typed: string
  wordIndex: number
  done: boolean
}

function draftAction(state: EngineState, event: InputEvent): Draft | null {
  const word = state.words[state.wordIndex]
  if (word === undefined) return null
  const placement = fingerFor(event.code)

  if (event.code === 'Backspace') {
    if (state.typed.length === 0) return null
    const removed = state.typed.at(-1) ?? ''
    const index = state.typed.length - 1
    let outcome: ActionOutcome
    if (index >= word.length) outcome = 'deleted_extra'
    else if (removed === word[index]) outcome = 'deleted_correct'
    else outcome = 'deleted_incorrect'
    return {
      typed: state.typed.slice(0, -1),
      wordIndex: state.wordIndex,
      done: false,
      action: baseAction(state, event, {
        kind: 'backspace',
        outcome,
        expectedChar: index < word.length ? (word[index] ?? null) : null,
        producedChar: removed,
        wordIndex: state.wordIndex,
        charIndex: index < word.length ? index : null,
        word,
        bigram: null,
        hand: placement?.hand ?? null,
        finger: placement?.finger ?? null,
        shift: false,
      }),
    }
  }

  if (event.code === 'Space') {
    if (state.typed === word && state.wordIndex < state.words.length - 1) {
      return {
        typed: '',
        wordIndex: state.wordIndex + 1,
        done: false,
        action: baseAction(state, event, {
          kind: 'commit',
          outcome: 'correct',
          expectedChar: ' ',
          producedChar: ' ',
          wordIndex: state.wordIndex,
          charIndex: null,
          word,
          bigram: null,
          hand: placement?.hand ?? null,
          finger: placement?.finger ?? null,
          shift: false,
        }),
      }
    }
    return {
      typed: state.typed,
      wordIndex: state.wordIndex,
      done: false,
      action: baseAction(state, event, {
        kind: 'reject',
        outcome: 'rejected_space',
        expectedChar: ' ',
        producedChar: ' ',
        wordIndex: state.wordIndex,
        charIndex: null,
        word,
        bigram: null,
        hand: placement?.hand ?? null,
        finger: placement?.finger ?? null,
        shift: false,
      }),
    }
  }

  const produced = charFor(state.spec.layoutId, event.code, event.shift)
  if (!produced) return null

  const index = state.typed.length
  let outcome: ActionOutcome
  let expected: string | null
  let charIndex: number | null
  let bigram: string | null
  if (index < word.length) {
    expected = word[index] ?? null
    charIndex = index
    outcome = produced === expected ? 'correct' : 'incorrect'
    const prev = index > 0 ? word[index - 1] : undefined
    bigram = prev && expected ? prev + expected : null
  } else {
    expected = null
    charIndex = null
    outcome = 'extra'
    bigram = null
  }
  const typed = state.typed + produced
  const done = state.wordIndex === state.words.length - 1 && typed === word
  return {
    typed,
    wordIndex: state.wordIndex,
    done,
    action: baseAction(state, event, {
      kind: 'commit',
      outcome,
      expectedChar: expected,
      producedChar: produced,
      wordIndex: state.wordIndex,
      charIndex,
      word,
      bigram,
      hand: placement?.hand ?? null,
      finger: placement?.finger ?? null,
      shift: event.shift,
    }),
  }
}

function baseAction(
  state: EngineState,
  event: InputEvent,
  fields: Omit<Action, 'seq' | 'tMs' | 'code' | 'ikiMs' | 'holdMs' | 'flightMs' | 'isHesitation' | 'afterError'>,
): Action {
  const previous = state.actions.at(-1)
  const previousHeld = previous?.code ? state.held[previous.code] : undefined
  const flight = previousHeld ? null : flightFromPrevious(state, event.tMs)
  return {
    ...fields,
    seq: state.nextSeq,
    tMs: event.tMs,
    code: event.code,
    ikiMs: null,
    holdMs: null,
    flightMs: flight,
    isHesitation: false,
    afterError: false,
  }
}

function flightFromPrevious(state: EngineState, tMs: number): number | null {
  const previous = state.actions.at(-1)
  if (!previous?.code) return null
  const up = [...state.events].reverse().find((candidate) => candidate.type === 'up' && candidate.code === previous.code)
  if (!up) return null
  return tMs - up.tMs
}

function counts(actions: readonly Action[]) {
  let correctChars = 0
  let incorrectChars = 0
  let extraChars = 0
  let backspaces = 0
  for (const action of actions) {
    if (action.outcome === 'correct') correctChars++
    else if (action.outcome === 'incorrect' || action.outcome === 'rejected_space') incorrectChars++
    else if (action.outcome === 'extra') extraChars++
    if (action.kind === 'backspace') backspaces++
  }
  return { correctChars, incorrectChars, extraChars, backspaces }
}

function durationOf(state: EngineState): number {
  if (state.spec.mode === 'time') return state.spec.modeValue * 1000
  if (state.actions.length < 2) return 0
  const first = state.actions[0]
  const last = state.actions.at(-1)
  if (!first || !last) return 0
  return last.tMs - first.tMs
}

/** Higher is steadier. Uses clean letter intervals only. */
export function consistencyOf(actions: readonly Action[]): number | null {
  const samples: number[] = []
  for (const action of actions) {
    if (!isCleanSpeed(action) || action.ikiMs == null) continue
    samples.push(action.ikiMs)
  }
  if (samples.length < 8) return null
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  if (mean <= 0) return null
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1)
  const cv = Math.sqrt(variance) / mean
  return Math.max(0, Math.min(100, Math.round(100 * (1 - cv))))
}

export function finalize(state: EngineState, options?: { completed?: boolean }): SessionResult {
  const { correctChars, incorrectChars, extraChars, backspaces } = counts(state.actions)
  const durationMs = durationOf(state)
  const minutes = durationMs / 60_000
  const attempted = correctChars + incorrectChars + extraChars
  const completed = options?.completed ?? (state.spec.mode === 'time' ? false : state.done)
  return {
    engineVersion: ENGINE_VERSION,
    wordlistVersion: WORDLIST_VERSION,
    spec: state.spec,
    words: [...state.words],
    targetText: state.words.join(' '),
    events: state.events,
    actions: state.actions,
    completed,
    durationMs,
    wpm: minutes > 0 ? correctChars / 5 / minutes : 0,
    rawWpm: minutes > 0 ? attempted / 5 / minutes : 0,
    accuracy: attempted > 0 ? correctChars / attempted : 0,
    consistency: consistencyOf(state.actions),
    correctChars,
    incorrectChars,
    extraChars,
    backspaces,
  }
}

export function replay(spec: TestSpec, events: readonly InputEvent[], words?: readonly string[]): SessionResult {
  let state = createTest(spec, words)
  for (const event of events) state = applyEvent(state, event)
  const last = events.at(-1)
  const timeDone = spec.mode === 'time' && last != null && last.tMs >= spec.modeValue * 1000 * TIME_SUBMIT_RATIO
  return finalize(state, { completed: spec.mode === 'time' ? timeDone : undefined })
}

export function toSessionRequest(state: EngineState, startedAt: string): SaveSessionRequest {
  return {
    engineVersion: ENGINE_VERSION,
    wordlistVersion: WORDLIST_VERSION,
    spec: state.spec,
    events: state.events,
    startedAt,
  }
}