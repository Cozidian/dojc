import { fingerChars } from './layouts.ts'
import {
  FINGER_DRILL_MIN_FRACTION,
  InputError,
  type LayoutId,
  type TestSpec,
} from './types.ts'
import { WORDLIST } from './wordlist.ts'

export function newSeed(): string {
  return crypto.randomUUID()
}

export function hashSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function targetWordCount(spec: TestSpec): number {
  if (spec.mode === 'time') return Math.max(50, spec.modeValue * 8)
  return spec.modeValue
}

export function fingerFraction(word: string, chars: Set<string>): number {
  if (word.length === 0) return 0
  let hits = 0
  for (const ch of word) if (chars.has(ch)) hits++
  return hits / word.length
}

function rngFor(spec: TestSpec): () => number {
  const material = [
    spec.seed,
    spec.layoutId,
    spec.mode,
    String(spec.modeValue),
    spec.drill?.kind ?? '',
    spec.drill?.target ?? '',
  ].join('|')
  return mulberry32(hashSeed(material))
}

export function poolFor(spec: TestSpec): readonly string[] {
  if (!spec.drill) return WORDLIST
  if (spec.drill.kind === 'bigram') {
    if (!/^[a-z]{2}$/.test(spec.drill.target)) throw new InputError('a letter pair looks like bl')
    const pool = WORDLIST.filter((word) => word.includes(spec.drill!.target))
    if (pool.length === 0) throw new InputError(`no words contain ${spec.drill.target}`)
    return pool
  }
  if (spec.drill.kind === 'letter') {
    if (!/^[a-z]$/.test(spec.drill.target)) throw new InputError('a letter looks like e')
    const pool = WORDLIST.filter((word) => word.includes(spec.drill!.target))
    if (pool.length === 0) throw new InputError(`no words contain ${spec.drill.target}`)
    return pool
  }
  if (spec.drill.kind === 'word') {
    if (!/^[a-z]{1,32}$/.test(spec.drill.target)) throw new InputError('a word looks like blue')
    return [spec.drill.target]
  }
  const match = /^(left|right):(pinky|ring|middle|index)$/.exec(spec.drill.target)
  if (!match) throw new InputError('a finger looks like left:pinky')
  const hand = match[1]
  const finger = match[2]
  if (!hand || !finger) throw new InputError('a finger looks like left:pinky')
  const chars = fingerChars(spec.layoutId, hand, finger)
  const pool = WORDLIST.filter((word) => fingerFraction(word, chars) >= FINGER_DRILL_MIN_FRACTION)
  if (pool.length === 0) throw new InputError(`no words train ${hand} ${finger}`)
  return pool
}

function pick(rng: () => number, pool: readonly string[], count: number): string[] {
  if (count < 1) throw new InputError('a test needs at least one word')
  if (pool.length >= count) {
    const copy = pool.slice()
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rng() * (copy.length - i))
      const left = copy[i]
      const right = copy[j]
      if (left === undefined || right === undefined) throw new Error('word pick missed')
      copy[i] = right
      copy[j] = left
    }
    return copy.slice(0, count)
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const word = pool[Math.floor(rng() * pool.length)]
    if (word === undefined) throw new Error('word pool was empty')
    out.push(word)
  }
  return out
}

export function generateWords(spec: TestSpec): string[] {
  if (spec.drill?.kind === 'word') return wordDrill(spec)
  return pick(rngFor(spec), poolFor(spec), targetWordCount(spec))
}

/** About one word in four is the target, and two targets never touch. */
function wordDrill(spec: TestSpec): string[] {
  const target = poolFor(spec)[0]
  if (!target) throw new InputError('a word looks like blue')
  const count = targetWordCount(spec)
  if (count < 1) throw new InputError('a test needs at least one word')
  let hits = Math.min(count, Math.max(1, Math.round(count / 4)))
  while (hits > 1 && Math.floor(count / hits) < 2) hits -= 1
  const rng = rngFor(spec)
  const at = new Set<number>()
  if (hits === 1) {
    at.add(Math.floor(rng() * count))
  } else {
    const gap = Math.floor(count / hits)
    const shift = Math.floor(rng() * gap)
    for (let i = 0; i < hits; i++) at.add(shift + i * gap)
  }
  const fillers = count === hits ? [] : pick(rng, WORDLIST.filter((word) => word !== target), count - hits)
  const words: string[] = []
  let fill = 0
  for (let i = 0; i < count; i++) {
    if (at.has(i)) {
      words.push(target)
      continue
    }
    const word = fillers[fill]
    if (word === undefined) throw new Error('word drill ran out of words')
    words.push(word)
    fill += 1
  }
  return words
}
