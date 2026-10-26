import { describe, expect, test } from 'vitest'
import { coach, median, type ActionSample, type Attempt, type OpenFocus } from './coaching.ts'

const NOW = '2026-10-22T12:00:00.000Z'

function attempts(ids: string[]): Attempt[] {
  return ids.map((sessionId, index) => ({
    sessionId,
    startedAt: `2026-10-22T12:00:${String(index).padStart(2, '0')}.000Z`,
    mode: 'words' as const,
    completed: true,
  }))
}

function taps(input: {
  sessionId: string
  hand: string
  finger: string
  iki: number
  n: number
  bigram?: string | null
  hesitation?: boolean
  mode?: Attempt['mode']
}): ActionSample[] {
  return Array.from({ length: input.n }, () => ({
    sessionId: input.sessionId,
    kind: 'commit' as const,
    outcome: 'correct' as const,
    bigram: input.bigram ?? null,
    hand: input.hand,
    finger: input.finger,
    ikiMs: input.iki,
    isHesitation: input.hesitation ?? false,
    afterError: false,
  }))
}

function balancedFingers(sessionId: string, iki: number): ActionSample[] {
  return [
    ...taps({ sessionId, hand: 'left', finger: 'ring', iki, n: 30 }),
    ...taps({ sessionId, hand: 'left', finger: 'middle', iki, n: 30 }),
    ...taps({ sessionId, hand: 'left', finger: 'index', iki, n: 30 }),
    ...taps({ sessionId, hand: 'right', finger: 'index', iki, n: 30 }),
    ...taps({ sessionId, hand: 'right', finger: 'middle', iki, n: 30 }),
    ...taps({ sessionId, hand: 'right', finger: 'ring', iki, n: 30 }),
    ...taps({ sessionId, hand: 'right', finger: 'pinky', iki, n: 30 }),
  ]
}

function report(actions: ActionSample[], openFocus: OpenFocus | null = null, extra: Partial<Parameters<typeof coach>[0]> = {}) {
  const ids = [...new Set(actions.map((action) => action.sessionId))]
  return coach({
    attempts: attempts(ids),
    actions,
    openFocus,
    layoutName: 'Dvorak',
    measurementTests: ids.length,
    nowIso: NOW,
    ...extra,
  })
}

describe('median', () => {
  test('averages the two central values when the count is even', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([1, 2, 3])).toBe(2)
    expect(median([])).toBeNull()
  })
})

describe('coaching', () => {
  test('a slow left pinky on dvorak becomes the focus', () => {
    const result = report([
      ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 200, n: 30 }),
      ...balancedFingers('s', 100),
    ])
    expect(result.focus).toMatchObject({ kind: 'finger', target: 'left:pinky', baselineMedianMs: 200 })
    expect(result.sentence).toBe(
      'On Dvorak, your left pinky is slowing you down. 200 ms between keys, against 100 ms for your other fingers.',
    )
  })

  test('a slow bl pair becomes the focus', () => {
    const result = report([
      ...balancedFingers('s', 100),
      ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 100, n: 30 }),
      ...taps({ sessionId: 's', hand: 'right', finger: 'index', iki: 300, n: 10, bigram: 'bl' }),
      ...taps({ sessionId: 's', hand: 'left', finger: 'index', iki: 100, n: 30, bigram: 'th' }),
    ])
    expect(result.focus).toMatchObject({ kind: 'bigram', target: 'bl' })
    expect(result.sentence).toBe(
      'On Dvorak, "bl" is holding you back. 300 ms between those letters, against 100 ms for your other pairs.',
    )
  })

  test('ignores a gap that is large as a ratio but tiny in milliseconds', () => {
    const result = report([
      ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 30, n: 30 }),
      ...balancedFingers('s', 20),
    ])
    expect(result.focus).toBeNull()
  })

  test('waits until a finger has enough clean keystrokes', () => {
    const result = report([
      ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 200, n: 10 }),
      ...balancedFingers('s', 100),
    ])
    expect(result.focus).toBeNull()
  })

  test('pauses do not make a finger look slow', () => {
    const result = report([
      ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 5000, n: 30, hesitation: true }),
      ...balancedFingers('s', 100),
    ])
    expect(result.focus).toBeNull()
  })

  test('drill sessions do not train the diagnosis', () => {
    const result = coach({
      attempts: [{ sessionId: 'drill', startedAt: '2026-10-22T12:00:00.000Z', mode: 'drill', completed: true }],
      actions: [
        ...taps({ sessionId: 'drill', hand: 'left', finger: 'pinky', iki: 400, n: 30 }),
        ...balancedFingers('drill', 100),
      ],
      openFocus: null,
      layoutName: 'Dvorak',
      measurementTests: 0,
      nowIso: NOW,
    })
    expect(result.focus).toBeNull()
  })

  test('keeps the open focus while it is still slow, even if something else is slower', () => {
    const open: OpenFocus = {
      id: 'focus-1',
      kind: 'finger',
      target: 'left:pinky',
      openedAt: '2026-10-01T00:00:00.000Z',
      baselineMedianMs: 200,
      baselineSamples: 30,
    }
    const result = report(
      [
        ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 200, n: 30 }),
        ...balancedFingers('s', 100),
        ...taps({ sessionId: 's', hand: 'right', finger: 'index', iki: 500, n: 10, bigram: 'bl' }),
        ...taps({ sessionId: 's', hand: 'left', finger: 'index', iki: 100, n: 30, bigram: 'th' }),
      ],
      open,
    )
    expect(result.focus).toBe(open)
    expect(result.closed).toBeNull()
    expect(result.sentence).toMatch(/left pinky/)
  })

  test('closes a focus once it has caught up and says so when nothing else stands out', () => {
    const open: OpenFocus = {
      id: 'focus-1',
      kind: 'finger',
      target: 'left:pinky',
      openedAt: '2026-10-01T00:00:00.000Z',
      baselineMedianMs: 200,
      baselineSamples: 30,
    }
    const result = report(
      [
        ...taps({ sessionId: 's', hand: 'left', finger: 'pinky', iki: 110, n: 30 }),
        ...balancedFingers('s', 100),
      ],
      open,
    )
    expect(result.focus).toBeNull()
    expect(result.closed).toMatchObject({ reason: 'improved', target: 'left:pinky' })
    expect(result.sentence).toBe('On Dvorak, your left pinky has caught up. Nothing else stands out yet.')
  })

  test('only the trailing window is diagnosed', () => {
    const open: OpenFocus = {
      id: 'focus-1',
      kind: 'finger',
      target: 'left:pinky',
      openedAt: '2026-10-01T00:00:00.000Z',
      baselineMedianMs: 200,
      baselineSamples: 30,
    }
    const actions = [
      ...taps({ sessionId: 'old', hand: 'left', finger: 'pinky', iki: 400, n: 30 }),
      ...balancedFingers('old', 100),
      ...taps({ sessionId: 'new', hand: 'left', finger: 'pinky', iki: 100, n: 30 }),
      ...balancedFingers('new', 100),
    ]
    const result = coach({
      attempts: attempts(['old', 'new']),
      actions,
      openFocus: open,
      layoutName: 'Dvorak',
      measurementTests: 2,
      nowIso: NOW,
      trailingSessions: 1,
    })
    expect(result.closed?.reason).toBe('improved')
    expect(result.focus).toBeNull()
  })
})
