import { describe, expect, test } from 'vitest'
import type { ActionSample } from './coaching.ts'
import { caughtUpLine, FINGER_TARGETS, fingerBars, focusTrace } from './progress.ts'

describe('finger bars', () => {
  test('keeps keyboard order and hides a finger without enough clean intervals', () => {
    const bars = fingerBars([
      { target: 'right:index', medianMs: 90, samples: 40 },
      { target: 'left:pinky', medianMs: 200, samples: 24 },
      { target: 'left:ring', medianMs: 140, samples: 25 },
    ])
    expect(bars.map((bar) => bar.target)).toEqual([...FINGER_TARGETS])
    expect(bars[0]).toEqual({ target: 'left:pinky', medianMs: null, samples: 24 })
    expect(bars[1]).toEqual({ target: 'left:ring', medianMs: 140, samples: 25 })
    expect(bars.find((bar) => bar.target === 'right:index')).toEqual({
      target: 'right:index',
      medianMs: 90,
      samples: 40,
    })
    expect(bars.find((bar) => bar.target === 'right:pinky')).toEqual({
      target: 'right:pinky',
      medianMs: null,
      samples: 0,
    })
  })
})

describe('focus trace', () => {
  test('draws the clean gap of one focus on each measured test', () => {
    const attempts = [
      { sessionId: 'later', startedAt: '2026-10-22T11:00:00.000Z' },
      { sessionId: 'early', startedAt: '2026-10-22T10:00:00.000Z' },
      { sessionId: 'empty', startedAt: '2026-10-22T09:00:00.000Z' },
    ]
    const actions = [
      hit('early', { ikiMs: 500 }),
      hit('early', { ikiMs: 300 }),
      hit('early', { ikiMs: 900, isHesitation: true }),
      hit('later', { ikiMs: 220 }),
      hit('later', { bigram: 'bl', ikiMs: 40 }),
      hit('outside', { ikiMs: 10 }),
    ]
    expect(focusTrace(attempts, actions, { kind: 'bigram', target: 'ho' })).toEqual([
      { id: 'early', startedAt: '2026-10-22T10:00:00.000Z', medianMs: 400 },
      { id: 'later', startedAt: '2026-10-22T11:00:00.000Z', medianMs: 220 },
    ])
    expect(focusTrace(attempts, [hit('early', { hand: 'left', finger: 'pinky', ikiMs: 180 })], {
      kind: 'finger',
      target: 'left:pinky',
    })).toEqual([{ id: 'early', startedAt: '2026-10-22T10:00:00.000Z', medianMs: 180 }])
    expect(caughtUpLine({ kind: 'bigram', target: 'ho' })).toBe('"ho" caught up.')
    expect(caughtUpLine({ kind: 'finger', target: 'left:pinky' })).toBe('left pinky caught up.')
  })
})

function hit(sessionId: string, overrides: Partial<ActionSample>): ActionSample {
  return {
    sessionId,
    kind: 'commit',
    outcome: 'correct',
    bigram: 'ho',
    hand: 'right',
    finger: 'index',
    ikiMs: 400,
    isHesitation: false,
    afterError: false,
    ...overrides,
  }
}
