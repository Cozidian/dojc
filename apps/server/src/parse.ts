import {
  ENGINE_VERSION,
  InputError,
  WORDLIST_VERSION,
  isLayoutId,
  type Drill,
  type InputEvent,
  type SaveSessionRequest,
  type TestSpec,
} from '@dojc/core'

export function parseSaveRequest(body: unknown): SaveSessionRequest {
  if (!body || typeof body !== 'object') throw new InputError('body must be an object')
  const record = body as Record<string, unknown>
  if (record.engineVersion !== ENGINE_VERSION || record.wordlistVersion !== WORDLIST_VERSION) {
    throw new InputError('reload to update the dojo')
  }
  if (typeof record.startedAt !== 'string' || Number.isNaN(Date.parse(record.startedAt))) {
    throw new InputError('startedAt is invalid')
  }
  const spec = parseSpec(record.spec)
  const events = parseEvents(record.events)
  if (events.length === 0) throw new InputError('test is empty')
  if (events.length > 20_000) throw new InputError('test is too long')
  return {
    engineVersion: ENGINE_VERSION,
    wordlistVersion: WORDLIST_VERSION,
    spec,
    events,
    startedAt: record.startedAt,
  }
}

function parseSpec(value: unknown): TestSpec {
  if (!value || typeof value !== 'object') throw new InputError('spec is missing')
  const spec = value as Record<string, unknown>
  if (spec.languageId !== 'en') throw new InputError('only English is available')
  if (typeof spec.layoutId !== 'string' || !isLayoutId(spec.layoutId)) throw new InputError('unknown layout')
  if (spec.correctionPolicy !== 'must_fix') throw new InputError('unknown correction policy')
  if (typeof spec.seed !== 'string' || spec.seed.length === 0 || spec.seed.length > 80) {
    throw new InputError('seed is missing')
  }
  if (typeof spec.modeValue !== 'number' || !Number.isInteger(spec.modeValue)) {
    throw new InputError('mode value is invalid')
  }
  const mode = spec.mode
  const drill = parseDrill(spec.drill)
  if (mode === 'words') {
    if (drill) throw new InputError('only a drill can set a target')
    if (spec.modeValue < 1 || spec.modeValue > 200) throw new InputError('word count is out of range')
  } else if (mode === 'drill') {
    if (!drill) throw new InputError('a drill needs a target')
    if (spec.modeValue < 1 || spec.modeValue > 100) throw new InputError('drill length is out of range')
  } else if (mode === 'time') {
    if (drill) throw new InputError('only a drill can set a target')
    if (spec.modeValue < 10 || spec.modeValue > 360) throw new InputError('time is out of range')
  } else {
    throw new InputError('unknown mode')
  }
  return {
    languageId: 'en',
    layoutId: spec.layoutId,
    mode,
    modeValue: spec.modeValue,
    seed: spec.seed,
    drill,
    correctionPolicy: 'must_fix',
  }
}

function parseDrill(value: unknown): Drill | null {
  if (value == null) return null
  if (!value || typeof value !== 'object') throw new InputError('drill is invalid')
  const drill = value as Record<string, unknown>
  if (drill.kind !== 'bigram' && drill.kind !== 'finger' && drill.kind !== 'letter' && drill.kind !== 'word') {
    throw new InputError('drill is invalid')
  }
  if (typeof drill.target !== 'string') throw new InputError('drill is invalid')
  if (drill.kind === 'bigram' && !/^[a-z]{2}$/.test(drill.target)) throw new InputError('a letter pair looks like bl')
  if (drill.kind === 'letter' && !/^[a-z]$/.test(drill.target)) throw new InputError('a letter looks like e')
  if (drill.kind === 'word' && !/^[a-z]{1,32}$/.test(drill.target)) throw new InputError('a word looks like blue')
  if (drill.kind === 'finger' && !/^(left|right):(pinky|ring|middle|index)$/.test(drill.target)) {
    throw new InputError('a finger looks like left:pinky')
  }
  return { kind: drill.kind, target: drill.target }
}

function parseEvents(value: unknown): InputEvent[] {
  if (!Array.isArray(value)) throw new InputError('events must be a list')
  const events: InputEvent[] = []
  let previous = -1
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new InputError('bad event')
    const event = item as Record<string, unknown>
    if (typeof event.tMs !== 'number' || !Number.isFinite(event.tMs) || event.tMs < 0) {
      throw new InputError('event time is invalid')
    }
    if (event.tMs < previous) throw new InputError('event time went backwards')
    previous = event.tMs
    if (event.type !== 'down' && event.type !== 'up') throw new InputError('bad event type')
    if (typeof event.code !== 'string' || event.code.length === 0 || event.code.length > 32) {
      throw new InputError('bad key code')
    }
    if (typeof event.key !== 'string' || event.key.length > 32) throw new InputError('bad key')
    if (typeof event.shift !== 'boolean' || typeof event.shortcut !== 'boolean') {
      throw new InputError('bad modifiers')
    }
    events.push({
      tMs: event.tMs,
      type: event.type,
      code: event.code,
      key: event.key,
      shift: event.shift,
      shortcut: event.shortcut,
    })
  }
  return events
}
