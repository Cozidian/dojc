import { describe, expect, test } from 'vitest'
import { applyEvent, createTest, finalize, replay, type EngineState } from './engine.ts'
import { fingerFor } from './geometry.ts'
import { charFor, codeForChar } from './layouts.ts'
import type { InputEvent, LayoutId, TestSpec } from './types.ts'

function spec(overrides: Partial<TestSpec> = {}): TestSpec {
  return {
    languageId: 'en',
    layoutId: 'qwerty-ansi',
    mode: 'words',
    modeValue: 1,
    seed: 'seed',
    drill: null,
    correctionPolicy: 'must_fix',
    ...overrides,
  }
}

type Step = { t: number; ch: string; shift?: boolean; shortcut?: boolean; hold?: number } | { t: number; code: 'Backspace'; hold?: number }

function stepEvent(layoutId: LayoutId, step: Step, phase: 'down' | 'up', tMs: number): InputEvent {
  if ('code' in step) {
    return { tMs, type: phase, code: 'Backspace', key: 'Backspace', shift: false, shortcut: false }
  }
  if (step.ch === ' ') {
    return { tMs, type: phase, code: 'Space', key: ' ', shift: false, shortcut: step.shortcut ?? false }
  }
  return {
    tMs,
    type: phase,
    code: codeForChar(layoutId, step.ch),
    key: step.shift ? step.ch.toUpperCase() : step.ch,
    shift: step.shift ?? false,
    shortcut: step.shortcut ?? false,
  }
}

function play(layoutId: LayoutId, words: string[], steps: Step[]): { state: EngineState; result: ReturnType<typeof finalize> } {
  let state = createTest(spec({ layoutId, modeValue: words.length }), words)
  for (const step of steps) {
    const hold = step.hold ?? 50
    state = applyEvent(state, stepEvent(layoutId, step, 'down', step.t))
    state = applyEvent(state, stepEvent(layoutId, step, 'up', step.t + hold))
  }
  return { state, result: finalize(state) }
}

describe('scoring', () => {
  test('counts a word as five characters and starts the clock on the first key', () => {
    const { result } = play('qwerty-ansi', ['ab'], [
      { t: 0, ch: 'a' },
      { t: 1000, ch: 'b' },
    ])
    expect(result.completed).toBe(true)
    expect(result.correctChars).toBe(2)
    expect(result.wpm).toBeCloseTo(24)
    expect(result.accuracy).toBe(1)
    expect(result.durationMs).toBe(1000)
  })

  test('counts the space between words and not a trailing space', () => {
    const { result } = play('qwerty-ansi', ['ab', 'cd'], [
      { t: 0, ch: 'a' },
      { t: 1000, ch: 'b' },
      { t: 2000, ch: ' ' },
      { t: 3000, ch: 'c' },
      { t: 4000, ch: 'd' },
    ])
    expect(result.completed).toBe(true)
    expect(result.correctChars).toBe(5)
    expect(result.wpm).toBeCloseTo(15)
    expect(result.actions.map((action) => action.bigram)).toEqual([null, 'ab', null, null, 'cd'])
  })

  test('a mistype must be repaired before the next word', () => {
    const { state, result } = play('qwerty-ansi', ['ab', 'cd'], [
      { t: 0, ch: 'a' },
      { t: 1000, ch: 'x' },
      { t: 2000, ch: ' ' },
    ])
    expect(state.wordIndex).toBe(0)
    expect(state.typed).toBe('ax')
    expect(result.completed).toBe(false)
    const space = result.actions.at(-1)
    expect(space?.outcome).toBe('rejected_space')
    expect(space?.finger).toBe('thumb')
  })

  test('the mistyped key is not marked as a repair, and the retype is', () => {
    const { result } = play('qwerty-ansi', ['ab'], [
      { t: 0, ch: 'a' },
      { t: 1000, ch: 'x' },
      { t: 2000, code: 'Backspace' },
      { t: 3000, ch: 'b' },
    ])
    const wrong = result.actions.find((action) => action.producedChar === 'x')
    const fixed = result.actions.find((action) => action.producedChar === 'b')
    expect(wrong).toMatchObject({ outcome: 'incorrect', expectedChar: 'b', bigram: 'ab', afterError: false })
    expect(fixed).toMatchObject({ outcome: 'correct', afterError: true })
    expect(result.actions.find((action) => action.kind === 'backspace')?.finger).toBe('pinky')
    expect(result.completed).toBe(true)
    expect(result.accuracy).toBeCloseTo(2 / 3)
    expect(result.backspaces).toBe(1)
    expect(result.wpm).toBeCloseTo(8)
  })

  test('backspace at the start of a word does nothing to the transcript', () => {
    const { state } = play('qwerty-ansi', ['ab'], [{ t: 0, code: 'Backspace' }])
    expect(state.typed).toBe('')
    expect(state.actions).toHaveLength(0)
    expect(state.events).toHaveLength(2)
  })

  test('shift produces the shifted character and still uses the letter finger', () => {
    const { result } = play('qwerty-ansi', ['ab'], [{ t: 0, ch: 'a', shift: true }])
    expect(result.actions[0]).toMatchObject({
      producedChar: 'A',
      outcome: 'incorrect',
      shift: true,
      finger: 'pinky',
      hand: 'left',
      code: 'KeyA',
    })
  })

  test('a long gap is a pause on the key that follows it', () => {
    const { result } = play('qwerty-ansi', ['ab'], [
      { t: 0, ch: 'a' },
      { t: 1500, ch: 'b' },
    ])
    expect(result.actions[1]?.isHesitation).toBe(true)
    expect(result.actions[0]?.isHesitation).toBe(false)
  })
})

describe('timing', () => {
  test('records hold, flight, and the interval between keydowns', () => {
    let state = createTest(spec(), ['ab'])
    const a = codeForChar('qwerty-ansi', 'a')
    const b = codeForChar('qwerty-ansi', 'b')
    const down = (tMs: number, code: string, key: string): InputEvent => ({
      tMs,
      type: 'down',
      code,
      key,
      shift: false,
      shortcut: false,
    })
    const up = (tMs: number, code: string, key: string): InputEvent => ({ ...down(tMs, code, key), type: 'up' })
    state = applyEvent(state, down(0, a, 'a'))
    state = applyEvent(state, up(80, a, 'a'))
    state = applyEvent(state, down(200, b, 'b'))
    state = applyEvent(state, up(260, b, 'b'))
    const result = finalize(state)
    expect(result.actions[0]).toMatchObject({ holdMs: 80, flightMs: null, ikiMs: null })
    expect(result.actions[1]).toMatchObject({ holdMs: 60, flightMs: 120, ikiMs: 200 })
  })

  test('a key held across the next keydown has a negative flight', () => {
    let state = createTest(spec(), ['ab'])
    const a = codeForChar('qwerty-ansi', 'a')
    const b = codeForChar('qwerty-ansi', 'b')
    const event = (tMs: number, type: 'down' | 'up', code: string, key: string): InputEvent => ({
      tMs,
      type,
      code,
      key,
      shift: false,
      shortcut: false,
    })
    state = applyEvent(state, event(0, 'down', a, 'a'))
    state = applyEvent(state, event(100, 'down', b, 'b'))
    state = applyEvent(state, event(150, 'up', a, 'a'))
    state = applyEvent(state, event(180, 'up', b, 'b'))
    const result = finalize(state)
    expect(result.actions[0]?.holdMs).toBe(150)
    expect(result.actions[1]).toMatchObject({ holdMs: 80, flightMs: -50, ikiMs: 100 })
  })

  test('key repeat does not type the character twice', () => {
    let state = createTest(spec(), ['a'])
    const code = codeForChar('qwerty-ansi', 'a')
    const event = (tMs: number, type: 'down' | 'up'): InputEvent => ({
      tMs,
      type,
      code,
      key: 'a',
      shift: false,
      shortcut: false,
    })
    state = applyEvent(state, event(0, 'down'))
    state = applyEvent(state, event(30, 'down'))
    state = applyEvent(state, event(100, 'up'))
    const result = finalize(state)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.holdMs).toBe(100)
    expect(state.typed).toBe('a')
  })
})

describe('layouts', () => {
  test('the same physical key keeps its finger and changes its letter', () => {
    expect(fingerFor('KeyS')).toEqual({ hand: 'left', finger: 'ring' })
    expect(charFor('qwerty-ansi', 'KeyS', false)).toBe('s')
    expect(charFor('dvorak-ansi', 'KeyS', false)).toBe('o')
  })

  test('bl uses different fingers on qwerty and dvorak', () => {
    const qwerty = play('qwerty-ansi', ['blue'], [
      { t: 0, ch: 'b' },
      { t: 100, ch: 'l' },
      { t: 200, ch: 'u' },
      { t: 300, ch: 'e' },
    ]).result
    const dvorak = play('dvorak-ansi', ['blue'], [
      { t: 0, ch: 'b' },
      { t: 100, ch: 'l' },
      { t: 200, ch: 'u' },
      { t: 300, ch: 'e' },
    ]).result
    expect(qwerty.actions[0]).toMatchObject({ producedChar: 'b', hand: 'left', finger: 'index', code: 'KeyB' })
    expect(qwerty.actions[1]).toMatchObject({ producedChar: 'l', bigram: 'bl', hand: 'right', finger: 'ring', code: 'KeyL' })
    expect(dvorak.actions[0]).toMatchObject({ producedChar: 'b', hand: 'right', finger: 'index', code: 'KeyN' })
    expect(dvorak.actions[1]).toMatchObject({ producedChar: 'l', bigram: 'bl', hand: 'right', finger: 'pinky', code: 'KeyP' })
  })
})

describe('replay', () => {
  test('time mode uses the clock and ignores the gap before the first key', () => {
    const testSpec = spec({ mode: 'time', modeValue: 60 })
    const words = ['ab']
    let state = createTest(testSpec, words)
    const events: InputEvent[] = []
    const push = (event: InputEvent) => {
      events.push(event)
      state = applyEvent(state, event)
    }
    const tap = (tMs: number, ch: string) => {
      const code = codeForChar('qwerty-ansi', ch)
      push({ tMs, type: 'down', code, key: ch, shift: false, shortcut: false })
      push({ tMs: tMs + 40, type: 'up', code, key: ch, shift: false, shortcut: false })
    }
    tap(5000, 'a')
    tap(6000, 'b')
    push({ tMs: 54_000, type: 'down', code: 'ShiftLeft', key: 'Shift', shift: true, shortcut: false })
    push({ tMs: 54_050, type: 'up', code: 'ShiftLeft', key: 'Shift', shift: false, shortcut: false })
    const result = replay(testSpec, events, words)
    expect(result.durationMs).toBe(60_000)
    expect(result.correctChars).toBe(2)
    expect(result.wpm).toBeCloseTo(0.4)
    expect(result.completed).toBe(true)
  })

  test('rejects a clock that runs backwards', () => {
    let state = createTest(spec(), ['a'])
    state = applyEvent(state, { tMs: 10, type: 'down', code: 'KeyA', key: 'a', shift: false, shortcut: false })
    expect(() => applyEvent(state, { tMs: 9, type: 'up', code: 'KeyA', key: 'a', shift: false, shortcut: false })).toThrow(
      /backwards/,
    )
  })

  test('control shortcuts and unbound keys do not change the transcript', () => {
    let state = createTest(spec(), ['a'])
    state = applyEvent(state, { tMs: 0, type: 'down', code: 'KeyA', key: 'a', shift: false, shortcut: true })
    state = applyEvent(state, { tMs: 20, type: 'up', code: 'KeyA', key: 'a', shift: false, shortcut: false })
    state = applyEvent(state, { tMs: 40, type: 'down', code: 'Digit1', key: '1', shift: false, shortcut: false })
    state = applyEvent(state, { tMs: 60, type: 'up', code: 'Digit1', key: '1', shift: false, shortcut: false })
    expect(state.typed).toBe('')
    expect(state.actions).toHaveLength(0)
    expect(state.events).toHaveLength(4)
  })

  test('replay rebuilds the same transcript from stored words', () => {
    const testSpec = spec({ layoutId: 'dvorak-ansi', seed: 'other-seed', modeValue: 2 })
    const first = play('dvorak-ansi', ['blue', 'black'], [
      { t: 0, ch: 'b' },
      { t: 80, ch: 'l' },
      { t: 160, ch: 'u' },
      { t: 240, ch: 'e' },
      { t: 320, ch: ' ' },
      { t: 400, ch: 'b' },
      { t: 480, ch: 'l' },
      { t: 560, ch: 'a' },
      { t: 640, ch: 'c' },
      { t: 720, ch: 'k' },
    ])
    const again = replay(testSpec, first.result.events, ['blue', 'black'])
    expect(again.targetText).toBe('blue black')
    expect(again.actions.map((action) => action.producedChar)).toEqual(first.result.actions.map((action) => action.producedChar))
    expect(again.wpm).toBeCloseTo(first.result.wpm)
  })
})

