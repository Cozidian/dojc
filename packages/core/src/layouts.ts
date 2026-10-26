import { PHYSICAL_KEYS } from './geometry.ts'
import { GEOMETRY_ID, LANGUAGE_ID, InputError, type GeometryId, type LanguageId, type LayoutId } from './types.ts'

export type KeyBinding = { unshifted: string; shifted: string }

export type Layout = {
  id: LayoutId
  name: string
  languageId: LanguageId
  geometryId: GeometryId
  keys: Record<string, KeyBinding>
}

const TOP = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']
const HOME = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']
const BOTTOM = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']

function bind(rows: { codes: string[]; lower: string; upper: string }[]): Record<string, KeyBinding> {
  const keys: Record<string, KeyBinding> = {}
  for (const row of rows) {
    if (row.codes.length !== row.lower.length || row.lower.length !== row.upper.length) {
      throw new Error(`layout row length mismatch: ${row.lower}`)
    }
    for (let i = 0; i < row.codes.length; i++) {
      const code = row.codes[i]
      const unshifted = row.lower[i]
      const shifted = row.upper[i]
      if (!code || !unshifted || !shifted) throw new Error('layout row has a hole')
      keys[code] = { unshifted, shifted }
    }
  }
  return keys
}

export const LAYOUTS: Record<LayoutId, Layout> = {
  'qwerty-ansi': {
    id: 'qwerty-ansi',
    name: 'QWERTY',
    languageId: LANGUAGE_ID,
    geometryId: GEOMETRY_ID,
    keys: bind([
      { codes: TOP, lower: 'qwertyuiop', upper: 'QWERTYUIOP' },
      { codes: HOME, lower: 'asdfghjkl;', upper: 'ASDFGHJKL:' },
      { codes: BOTTOM, lower: 'zxcvbnm,./', upper: 'ZXCVBNM<>?' },
      { codes: ['Quote'], lower: "'", upper: '"' },
    ]),
  },
  'dvorak-ansi': {
    id: 'dvorak-ansi',
    name: 'Dvorak',
    languageId: LANGUAGE_ID,
    geometryId: GEOMETRY_ID,
    keys: bind([
      { codes: TOP, lower: "',.pyfgcrl", upper: '"<>PYFGCRL' },
      { codes: HOME, lower: 'aoeuidhtns', upper: 'AOEUIDHTNS' },
      { codes: BOTTOM, lower: ';qjkxbmwvz', upper: ':QJKXBMWVZ' },
      { codes: ['Quote'], lower: '-', upper: '_' },
    ]),
  },
}

export function isLayoutId(value: string): value is LayoutId {
  return value in LAYOUTS
}

export function layoutName(id: LayoutId): string {
  return LAYOUTS[id].name
}

export function layoutIds(): LayoutId[] {
  return Object.keys(LAYOUTS) as LayoutId[]
}

export function charFor(layoutId: LayoutId, code: string, shift: boolean): string | null {
  const binding = LAYOUTS[layoutId].keys[code]
  if (!binding) return null
  return shift ? binding.shifted : binding.unshifted
}

export function codeForChar(layoutId: LayoutId, ch: string): string {
  for (const [code, binding] of Object.entries(LAYOUTS[layoutId].keys)) {
    if (binding.unshifted === ch) return code
  }
  throw new InputError(`no ${layoutName(layoutId)} key produces ${ch}`)
}

/** Letters this finger types on the layout. Punctuation is left out of drills. */
export function fingerChars(layoutId: LayoutId, hand: string, finger: string): Set<string> {
  const chars = new Set<string>()
  for (const key of PHYSICAL_KEYS) {
    if (key.hand !== hand || key.finger !== finger) continue
    const binding = LAYOUTS[layoutId].keys[key.code]
    if (binding && /^[a-z]$/.test(binding.unshifted)) chars.add(binding.unshifted)
  }
  return chars
}
