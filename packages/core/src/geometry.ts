import type { Finger, Hand } from './types.ts'

export type PhysicalKey = {
  code: string
  row: number
  col: number
  hand: Hand
  finger: Finger
}

/**
 * ANSI home-row fingering. B is the left index, M is the right index.
 * Finger follows the physical key, so it stays put when the letter moves to another layout.
 */
export const PHYSICAL_KEYS: readonly PhysicalKey[] = [
  { code: 'KeyQ', row: 1, col: 0, hand: 'left', finger: 'pinky' },
  { code: 'KeyW', row: 1, col: 1, hand: 'left', finger: 'ring' },
  { code: 'KeyE', row: 1, col: 2, hand: 'left', finger: 'middle' },
  { code: 'KeyR', row: 1, col: 3, hand: 'left', finger: 'index' },
  { code: 'KeyT', row: 1, col: 4, hand: 'left', finger: 'index' },
  { code: 'KeyY', row: 1, col: 5, hand: 'right', finger: 'index' },
  { code: 'KeyU', row: 1, col: 6, hand: 'right', finger: 'index' },
  { code: 'KeyI', row: 1, col: 7, hand: 'right', finger: 'middle' },
  { code: 'KeyO', row: 1, col: 8, hand: 'right', finger: 'ring' },
  { code: 'KeyP', row: 1, col: 9, hand: 'right', finger: 'pinky' },
  { code: 'Backspace', row: 1, col: 11, hand: 'right', finger: 'pinky' },

  { code: 'KeyA', row: 2, col: 0, hand: 'left', finger: 'pinky' },
  { code: 'KeyS', row: 2, col: 1, hand: 'left', finger: 'ring' },
  { code: 'KeyD', row: 2, col: 2, hand: 'left', finger: 'middle' },
  { code: 'KeyF', row: 2, col: 3, hand: 'left', finger: 'index' },
  { code: 'KeyG', row: 2, col: 4, hand: 'left', finger: 'index' },
  { code: 'KeyH', row: 2, col: 5, hand: 'right', finger: 'index' },
  { code: 'KeyJ', row: 2, col: 6, hand: 'right', finger: 'index' },
  { code: 'KeyK', row: 2, col: 7, hand: 'right', finger: 'middle' },
  { code: 'KeyL', row: 2, col: 8, hand: 'right', finger: 'ring' },
  { code: 'Semicolon', row: 2, col: 9, hand: 'right', finger: 'pinky' },
  { code: 'Quote', row: 2, col: 10, hand: 'right', finger: 'pinky' },

  { code: 'KeyZ', row: 3, col: 0, hand: 'left', finger: 'pinky' },
  { code: 'KeyX', row: 3, col: 1, hand: 'left', finger: 'ring' },
  { code: 'KeyC', row: 3, col: 2, hand: 'left', finger: 'middle' },
  { code: 'KeyV', row: 3, col: 3, hand: 'left', finger: 'index' },
  { code: 'KeyB', row: 3, col: 4, hand: 'left', finger: 'index' },
  { code: 'KeyN', row: 3, col: 5, hand: 'right', finger: 'index' },
  { code: 'KeyM', row: 3, col: 6, hand: 'right', finger: 'index' },
  { code: 'Comma', row: 3, col: 7, hand: 'right', finger: 'middle' },
  { code: 'Period', row: 3, col: 8, hand: 'right', finger: 'ring' },
  { code: 'Slash', row: 3, col: 9, hand: 'right', finger: 'pinky' },

  { code: 'Space', row: 4, col: 3, hand: 'thumb', finger: 'thumb' },
]

const BY_CODE = new Map(PHYSICAL_KEYS.map((key) => [key.code, key]))

export function fingerFor(code: string): { hand: Hand; finger: Finger } | null {
  const key = BY_CODE.get(code)
  if (!key) return null
  return { hand: key.hand, finger: key.finger }
}
