import { MISSES, type Drill } from './types.ts'

export type RunLetter = {
  char: string
  wrong: string[]
}

export type RunWord = {
  word: string
  letters: RunLetter[]
  extras: string[]
}

export type ReviewAction = {
  wordIndex: number
  kind: string
  outcome: string
  expectedChar: string | null
  producedChar: string | null
  charIndex: number | null
}

export type HabitAttempt = {
  sessionId: string
  startedAt: string
  mode: string
  completed: boolean
}

export type HabitAction = {
  sessionId: string
  wordIndex: number
  word: string
  kind: string
  outcome: string
  expectedChar: string | null
  producedChar: string | null
}

export type MissLetter = {
  letter: string
  attempts: number
  misses: number
  usual: string | null
}

export type MissWord = {
  word: string
  attempts: number
  misses: number
}

export type MissList = {
  letters: MissLetter[]
  words: MissWord[]
  tests: number
}

export type RunSummary = {
  id: string
  startedAt: string
  mode: 'words' | 'time' | 'drill'
  drill: Drill | null
  wpm: number
  accuracy: number
  consistency: number | null
}

export type RunDetail = RunSummary & {
  words: RunWord[]
}

export function reviewRun(words: readonly string[], actions: readonly ReviewAction[]): RunWord[] {
  const run: RunWord[] = words.map((word) => ({
    word,
    letters: [...word].map((char) => ({ char, wrong: [] as string[] })),
    extras: [],
  }))
  for (const action of actions) {
    if (action.kind !== 'commit') continue
    const word = run[action.wordIndex]
    if (!word) continue
    if (action.outcome === 'extra') {
      if (action.producedChar) word.extras.push(action.producedChar)
      continue
    }
    if (action.outcome !== 'incorrect' || action.charIndex == null || !action.producedChar) continue
    word.letters[action.charIndex]?.wrong.push(action.producedChar)
  }
  return run
}

export function runMissLine(word: RunWord): string | null {
  const parts: string[] = []
  for (const letter of word.letters) {
    if (letter.wrong.length === 0) continue
    parts.push(`${letter.char} as ${letter.wrong.join(' and ')}`)
  }
  if (word.extras.length > 0) parts.push(`extra ${word.extras.join('')}`)
  if (parts.length === 0) return null
  return `${word.word}, ${parts.join(', ')}`
}

export function missHabits(input: {
  attempts: readonly HabitAttempt[]
  actions: readonly HabitAction[]
  trailingSessions?: number
}): MissList {
  const trailing = input.trailingSessions ?? MISSES.trailingSessions
  const windowed = input.attempts
    .filter((attempt) => attempt.completed && attempt.mode !== 'drill')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.sessionId.localeCompare(b.sessionId))
    .slice(-trailing)
  const ids = new Set(windowed.map((attempt) => attempt.sessionId))
  const actions = input.actions.filter((action) => ids.has(action.sessionId) && action.kind === 'commit')

  const letters = new Map<string, { attempts: number; misses: number; produced: Map<string, number> }>()
  for (const action of actions) {
    if (action.outcome !== 'correct' && action.outcome !== 'incorrect') continue
    const expected = action.expectedChar
    if (!expected || !/^[a-z]$/.test(expected)) continue
    const row = letters.get(expected) ?? { attempts: 0, misses: 0, produced: new Map<string, number>() }
    row.attempts += 1
    if (action.outcome === 'incorrect' && action.producedChar) {
      row.misses += 1
      row.produced.set(action.producedChar, (row.produced.get(action.producedChar) ?? 0) + 1)
    }
    letters.set(expected, row)
  }

  const letterList: MissLetter[] = []
  for (const [letter, row] of letters) {
    if (row.attempts < MISSES.letterMinAttempts || row.misses < MISSES.letterMinMisses) continue
    letterList.push({ letter, attempts: row.attempts, misses: row.misses, usual: usualOf(row.produced) })
  }
  letterList.sort(byRate((item) => item.letter))

  const occurrences = new Map<string, { word: string; missed: boolean }>()
  for (const action of actions) {
    if (action.outcome !== 'correct' && action.outcome !== 'incorrect' && action.outcome !== 'extra') continue
    const key = `${action.sessionId}\0${action.wordIndex}`
    const row = occurrences.get(key) ?? { word: action.word, missed: false }
    if (action.outcome === 'incorrect' || action.outcome === 'extra') row.missed = true
    occurrences.set(key, row)
  }
  const byWord = new Map<string, { attempts: number; misses: number }>()
  for (const row of occurrences.values()) {
    const stat = byWord.get(row.word) ?? { attempts: 0, misses: 0 }
    stat.attempts += 1
    if (row.missed) stat.misses += 1
    byWord.set(row.word, stat)
  }
  const wordList: MissWord[] = []
  for (const [word, stat] of byWord) {
    if (stat.attempts < MISSES.wordMinAttempts || stat.misses < MISSES.wordMinMisses) continue
    wordList.push({ word, attempts: stat.attempts, misses: stat.misses })
  }
  wordList.sort(byRate((item) => item.word))

  return {
    letters: letterList.slice(0, MISSES.limit),
    words: wordList.slice(0, MISSES.limit),
    tests: windowed.length,
  }
}

export function habitLetterLine(letter: MissLetter): string {
  const usual = letter.usual ? `, usually typed as ${letter.usual}` : ''
  return `${letter.letter}, ${letter.misses} of ${letter.attempts}${usual}`
}

export function habitWordLine(word: MissWord): string {
  return `${word.word}, ${word.misses} of ${word.attempts}`
}

function usualOf(produced: Map<string, number>): string | null {
  let best: string | null = null
  let count = -1
  for (const [char, n] of produced) {
    if (n > count || (n === count && (best == null || char < best))) {
      best = char
      count = n
    }
  }
  return best
}

function byRate<T extends { attempts: number; misses: number }>(name: (item: T) => string) {
  return (a: T, b: T) => {
    const rate = b.misses / b.attempts - a.misses / a.attempts
    if (rate !== 0) return rate
    if (b.misses !== a.misses) return b.misses - a.misses
    return name(a).localeCompare(name(b))
  }
}
