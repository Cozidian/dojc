import { describe, expect, test } from 'vitest'
import {
  habitLetterLine,
  habitWordLine,
  missHabits,
  reviewRun,
  runMissLine,
  type HabitAction,
  type HabitAttempt,
  type ReviewAction,
} from './review.ts'

function press(
  wordIndex: number,
  outcome: ReviewAction['outcome'],
  expected: string | null,
  produced: string | null,
  charIndex: number | null,
): ReviewAction {
  return { wordIndex, kind: 'commit', outcome, expectedChar: expected, producedChar: produced, charIndex }
}

describe('reviewRun', () => {
  test('a repaired letter stays marked, and a rejected space does not', () => {
    const run = reviewRun(
      ['the', 'cat'],
      [
        press(0, 'incorrect', 't', 'g', 0),
        { wordIndex: 0, kind: 'backspace', outcome: 'deleted_incorrect', expectedChar: 't', producedChar: 'g', charIndex: 0 },
        press(0, 'correct', 't', 't', 0),
        press(0, 'correct', 'h', 'h', 1),
        press(0, 'incorrect', 'e', 'w', 2),
        press(0, 'incorrect', 'e', 'r', 2),
        { wordIndex: 0, kind: 'reject', outcome: 'rejected_space', expectedChar: null, producedChar: ' ', charIndex: null },
        press(1, 'correct', 'c', 'c', 0),
        press(1, 'extra', null, 'x', null),
        press(1, 'correct', 'a', 'a', 1),
        press(1, 'correct', 't', 't', 2),
      ],
    )

    expect(run).toHaveLength(2)
    expect(run[0]?.letters.map((letter) => letter.wrong)).toEqual([['g'], [], ['w', 'r']])
    expect(run[0]?.extras).toEqual([])
    expect(run[1]?.extras).toEqual(['x'])
    expect(runMissLine(run[0]!)).toBe('the, t as g, e as w and r')
    expect(runMissLine(run[1]!)).toBe('cat, extra x')
  })
})

function attempt(sessionId: string, startedAt: string, mode = 'words'): HabitAttempt {
  return { sessionId, startedAt, mode, completed: true }
}

function letterAction(
  sessionId: string,
  outcome: 'correct' | 'incorrect',
  expected: string,
  produced: string,
  word = 'word',
  wordIndex = 0,
): HabitAction {
  return {
    sessionId,
    wordIndex,
    word,
    kind: 'commit',
    outcome,
    expectedChar: expected,
    producedChar: produced,
  }
}

function letters(sessionId: string, expected: string, misses: number, attempts: number, produced = 'r'): HabitAction[] {
  const rows: HabitAction[] = []
  for (let i = 0; i < attempts; i++) {
    const wrong = i < misses
    rows.push(letterAction(sessionId, wrong ? 'incorrect' : 'correct', expected, wrong ? produced : expected))
  }
  return rows
}

describe('missHabits', () => {
  test('two misses in twenty tries stay off the list', () => {
    const result = missHabits({
      attempts: [attempt('s', '2026-10-22T12:00:00.000Z')],
      actions: letters('s', 'e', 2, 20),
    })
    expect(result.letters).toEqual([])
    expect(result.tests).toBe(1)
  })

  test('a letter missed four times is named with the usual substitute', () => {
    const actions = letters('s', 'e', 4, 20, 'r')
    actions.push(...letters('s', 'a', 6, 20, 's'))
    const result = missHabits({
      attempts: [attempt('s', '2026-10-22T12:00:00.000Z')],
      actions,
    })
    expect(result.letters.map((item) => item.letter)).toEqual(['a', 'e'])
    expect(result.letters[1]).toEqual({ letter: 'e', attempts: 20, misses: 4, usual: 'r' })
    expect(habitLetterLine(result.letters[1]!)).toBe('e, 4 of 20, usually typed as r')
  })

  test('a tied substitute picks the earlier letter', () => {
    const rows: HabitAction[] = []
    for (let i = 0; i < 20; i++) {
      const produced = i < 2 ? 't' : i < 4 ? 'r' : 'e'
      rows.push(letterAction('s', produced === 'e' ? 'correct' : 'incorrect', 'e', produced))
    }
    const result = missHabits({
      attempts: [attempt('s', '2026-10-22T12:00:00.000Z')],
      actions: rows,
    })
    expect(result.letters[0]?.usual).toBe('r')
  })

  test('a word missed twice in three tries is listed', () => {
    const blue = (sessionId: string, wrong: boolean): HabitAction =>
      letterAction(sessionId, wrong ? 'incorrect' : 'correct', 'b', wrong ? 'n' : 'b', 'blue', 0)
    const result = missHabits({
      attempts: [attempt('s1', '2026-10-01'), attempt('s2', '2026-10-02'), attempt('s3', '2026-10-03')],
      actions: [blue('s1', true), blue('s2', true), blue('s3', false)],
    })
    expect(result.words).toEqual([{ word: 'blue', attempts: 3, misses: 2 }])
    expect(habitWordLine(result.words[0]!)).toBe('blue, 2 of 3')
  })

  test('a single miss of a word stays off the list', () => {
    const once = (wrong: boolean, sessionId: string): HabitAction =>
      letterAction(sessionId, wrong ? 'incorrect' : 'correct', 'b', wrong ? 'n' : 'b', 'blue', 0)
    const result = missHabits({
      attempts: [attempt('s1', '2026-10-01'), attempt('s2', '2026-10-02'), attempt('s3', '2026-10-03')],
      actions: [once(true, 's1'), once(false, 's2'), once(false, 's3')],
    })
    expect(result.words).toEqual([])
  })

  test('a drill does not teach the list what you miss', () => {
    const result = missHabits({
      attempts: [
        attempt('drill', '2026-10-22T12:00:00.000Z', 'drill'),
        attempt('real', '2026-10-22T12:01:00.000Z'),
      ],
      actions: [...letters('drill', 'e', 10, 20), ...letters('real', 'e', 0, 20)],
    })
    expect(result.letters).toEqual([])
    expect(result.tests).toBe(1)
  })

  test('an older test falls out of a one-test window', () => {
    const result = missHabits({
      attempts: [attempt('old', '2026-10-01T00:00:00.000Z'), attempt('new', '2026-10-22T00:00:00.000Z')],
      actions: [...letters('old', 'e', 10, 20), ...letters('new', 'e', 0, 20)],
      trailingSessions: 1,
    })
    expect(result.letters).toEqual([])
    expect(result.tests).toBe(1)
  })
})
