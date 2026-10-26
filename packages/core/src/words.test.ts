import { describe, expect, test } from 'vitest'
import { fingerChars, layoutIds } from './layouts.ts'
import { FINGER_DRILL_MIN_FRACTION, WORDLIST_VERSION } from './types.ts'
import { WORDLIST } from './wordlist.ts'
import { fingerFraction, generateWords, poolFor } from './words.ts'
import type { TestSpec } from './types.ts'

function spec(overrides: Partial<TestSpec> = {}): TestSpec {
  return {
    languageId: 'en',
    layoutId: 'qwerty-ansi',
    mode: 'words',
    modeValue: 25,
    seed: 'alpha',
    drill: null,
    correctionPolicy: 'must_fix',
    ...overrides,
  }
}

describe('word list', () => {
  test('is a versioned list of plain english words', () => {
    expect(WORDLIST_VERSION).toBe('en-1')
    expect(WORDLIST.length).toBeGreaterThanOrEqual(200)
    for (const word of WORDLIST) expect(word).toMatch(/^[a-z]+$/)
  })

  test('the same seed replays the same test', () => {
    const first = generateWords(spec({ seed: 'same' }))
    const second = generateWords(spec({ seed: 'same' }))
    const other = generateWords(spec({ seed: 'different' }))
    expect(first).toEqual(second)
    expect(first).not.toEqual(other)
  })

  test('a bl drill is made of words that contain bl', () => {
    const words = generateWords(spec({ mode: 'drill', drill: { kind: 'bigram', target: 'bl' }, modeValue: 20 }))
    expect(words).toHaveLength(20)
    expect(words.every((word) => word.includes('bl'))).toBe(true)
    expect(poolFor(spec({ mode: 'drill', drill: { kind: 'bigram', target: 'bl' } })).length).toBeGreaterThanOrEqual(15)
  })

  test('a word drill sets the missed word among other words', () => {
    const drill = { kind: 'word' as const, target: 'finally' }
    const passage = spec({ mode: 'drill', drill, modeValue: 20, seed: 'word-finally' })
    const words = generateWords(passage)
    expect(words).toHaveLength(20)
    const at = words.flatMap((word, index) => (word === 'finally' ? [index] : []))
    expect(at).toHaveLength(5)
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(2)
    expect(words.filter((word) => word !== 'finally').every((word) => WORDLIST.includes(word))).toBe(true)
    expect(generateWords(passage)).toEqual(words)
    expect(() => poolFor(spec({ mode: 'drill', drill: { kind: 'word', target: 'Finally' } }))).toThrow(
      'a word looks like blue',
    )
  })

  test('a letter drill is made of words that contain that letter', () => {
    const drill = { kind: 'letter' as const, target: 'y' }
    const pool = poolFor(spec({ mode: 'drill', drill }))
    expect(pool.length).toBeGreaterThanOrEqual(15)
    expect(pool.every((word) => word.includes('y'))).toBe(true)
    const words = generateWords(spec({ mode: 'drill', drill, modeValue: 20, seed: 'letter-y' }))
    expect(words).toHaveLength(20)
    expect(words.every((word) => word.includes('y'))).toBe(true)
  })

  test('a finger drill prefers words that finger actually types', () => {
    for (const layoutId of layoutIds()) {
      const drill = { kind: 'finger' as const, target: 'left:pinky' }
      const chars = fingerChars(layoutId, 'left', 'pinky')
      const pool = poolFor(spec({ layoutId, mode: 'drill', drill }))
      expect(pool.length).toBeGreaterThanOrEqual(15)
      const words = generateWords(spec({ layoutId, mode: 'drill', drill, modeValue: 20, seed: layoutId }))
      for (const word of words) {
        expect(fingerFraction(word, chars)).toBeGreaterThanOrEqual(FINGER_DRILL_MIN_FRACTION)
      }
    }
  })

  test('time mode prepares a buffer longer than someone can finish', () => {
    const words = generateWords(spec({ mode: 'time', modeValue: 30 }))
    expect(words.length).toBeGreaterThanOrEqual(50)
  })
})

describe('layouts cover english', () => {
  test('each layout can produce every letter', async () => {
    const { LAYOUTS } = await import('./layouts.ts')
    for (const layout of Object.values(LAYOUTS)) {
      const letters = Object.values(layout.keys)
        .map((binding) => binding.unshifted)
        .filter((char) => /^[a-z]$/.test(char))
      expect(new Set(letters).size).toBe(26)
    }
  })
})
