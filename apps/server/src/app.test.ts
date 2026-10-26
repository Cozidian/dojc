import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import {
  applyEvent,
  codeForChar,
  createTest,
  finalize,
  toSessionRequest,
  type EngineState,
  type InputEvent,
  type RunDetail,
  type RunSummary,
  type TestSpec,
} from '@dojc/core'
import { createApp } from './app.ts'
import { all, get, openDatabase } from './db.ts'
import { rebuildSessions } from './store.ts'

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase(':memory:')
})

afterEach(() => {
  db.close()
})

function spec(overrides: Partial<TestSpec> = {}): TestSpec {
  return {
    languageId: 'en',
    layoutId: 'qwerty-ansi',
    mode: 'words',
    modeValue: 5,
    seed: 'round-trip',
    drill: null,
    correctionPolicy: 'must_fix',
    ...overrides,
  }
}

function typeWords(state: EngineState): EngineState {
  let t = 0
  for (const ch of state.words.join(' ')) {
    const code = ch === ' ' ? 'Space' : codeForChar(state.spec.layoutId, ch)
    const down: InputEvent = { tMs: t, type: 'down', code, key: ch, shift: false, shortcut: false }
    state = applyEvent(state, down)
    state = applyEvent(state, { ...down, tMs: t + 30, type: 'up' })
    t += 100
  }
  return state
}

describe('sessions', () => {
  test('the server replays the test and keeps the same score', async () => {
    const app = createApp(db)
    let state = createTest(spec())
    state = typeWords(state)
    const local = finalize(state)
    expect(local.completed).toBe(true)

    const response = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toSessionRequest(state, '2026-10-22T12:00:00.000Z')),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; wpm: number; coaching: { sentence: string | null; tests: number } }
    expect(body.wpm).toBeCloseTo(local.wpm)
    expect(body.coaching.tests).toBe(1)
    expect(body.coaching.sentence).toBeNull()

    const stored = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM key_events WHERE session_id = ?', body.id)
    expect(stored?.n).toBe(state.events.length)

    db.prepare(`UPDATE actions SET produced_char = 'ZZZ' WHERE session_id = ? AND seq = 0`).run(body.id)
    expect(rebuildSessions(db)).toBe(1)
    const repaired = get<{ produced_char: string }>(
      db,
      'SELECT produced_char FROM actions WHERE session_id = ? AND seq = 0',
      body.id,
    )
    expect(repaired?.produced_char).toBe(local.actions[0]?.producedChar)

    db.prepare('DELETE FROM sessions WHERE id = ?').run(body.id)
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM actions')?.n).toBe(0)
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM key_events')?.n).toBe(0)
  })

  test('an unfinished test is refused', async () => {
    const app = createApp(db)
    const state = createTest(spec())
    const response = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...toSessionRequest(state, '2026-10-22T12:00:00.000Z'),
        events: [{ tMs: 0, type: 'down', code: 'KeyA', key: 'a', shift: false, shortcut: false }],
      }),
    })
    expect(response.status).toBe(400)
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sessions')?.n).toBe(0)
  })

  test('an old client is told to reload', async () => {
    const app = createApp(db)
    const response = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engineVersion: '0', wordlistVersion: 'en-1' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('coaching rows', () => {
  test('a slow left pinky on dvorak is named, and a second read keeps the one focus', async () => {
    const app = createApp(db)
    const sessionId = 'session-dvorak'
    db.prepare(
      `INSERT INTO sessions (
         id, user_id, language_id, layout_id, geometry_id, mode, mode_value, drill_kind, drill_target,
         correction_policy, seed, wordlist_version, engine_version, target_text, started_at,
         duration_ms, completed, wpm, raw_wpm, accuracy, consistency,
         correct_chars, incorrect_chars, extra_chars, backspaces
       ) VALUES (
         ?, 'local', 'en', 'dvorak-ansi', 'ansi', 'words', 10, NULL, NULL,
         'must_fix', 'synthetic', 'en-1', '1', 'a', '2026-10-22T12:00:00.000Z',
         10000, 1, 0, 0, 1, NULL, 0, 0, 0, 0
       )`,
    ).run(sessionId)

    const insert = db.prepare(
      `INSERT INTO actions (
         session_id, seq, t_ms, kind, outcome, expected_char, produced_char, word_index, char_index, word,
         bigram, code, hand, finger, shift, iki_ms, hold_ms, flight_ms, is_hesitation, after_error
       ) VALUES (?, ?, ?, 'commit', 'correct', 'a', 'a', 0, 0, 'a', NULL, 'KeyA', ?, ?, 0, ?, NULL, NULL, 0, 0)`,
    )
    const fingers = [
      ['left', 'pinky', 200],
      ['left', 'ring', 100],
      ['left', 'middle', 100],
      ['left', 'index', 100],
      ['right', 'index', 100],
      ['right', 'middle', 100],
      ['right', 'ring', 100],
      ['right', 'pinky', 100],
    ] as const
    let seq = 0
    for (const [hand, finger, iki] of fingers) {
      for (let i = 0; i < 30; i++) {
        insert.run(sessionId, seq, seq * 100, hand, finger, iki)
        seq += 1
      }
    }

    const first = await app.request('/api/coaching?layoutId=dvorak-ansi')
    expect(first.status).toBe(200)
    const body = (await first.json()) as { sentence: string | null; focus: { target: string } | null }
    expect(body.sentence).toBe(
      'On Dvorak, your left pinky is slowing you down. 200 ms between keys, against 100 ms for your other fingers.',
    )
    expect(body.focus?.target).toBe('left:pinky')

    const second = await app.request('/api/coaching?layoutId=dvorak-ansi')
    expect(second.status).toBe(200)
    expect(all<{ id: string }>(db, `SELECT id FROM focuses WHERE closed_at IS NULL`)).toHaveLength(1)
  })
})

describe('run review', () => {
  test('a finished test opens with the letter that was wrong', async () => {
    const app = createApp(db)
    let state = createTest(spec())
    const target = state.words[0]?.[0] ?? 'a'
    const wrong = target === 'a' ? 'b' : 'a'
    let t = 0
    const hit = (ch: string, code = ch === ' ' ? 'Space' : codeForChar(state.spec.layoutId, ch)) => {
      const down: InputEvent = { tMs: t, type: 'down', code, key: ch, shift: false, shortcut: false }
      state = applyEvent(state, down)
      state = applyEvent(state, { ...down, tMs: t + 20, type: 'up' })
      t += 80
    }
    hit(wrong)
    hit('Backspace', 'Backspace')
    for (const ch of state.words.join(' ')) hit(ch)
    expect(finalize(state).completed).toBe(true)

    const saved = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toSessionRequest(state, '2026-10-22T12:00:00.000Z')),
    })
    const id = ((await saved.json()) as { id: string }).id

    const opened = await app.request(`/api/runs/${id}`)
    expect(opened.status).toBe(200)
    const run = (await opened.json()) as RunDetail
    expect(run.words[0]?.letters[0]).toEqual({ char: target, wrong: [wrong] })
    expect(run.words[0]?.letters.slice(1).every((letter) => letter.wrong.length === 0)).toBe(true)

    const list = await app.request('/api/runs?layoutId=qwerty-ansi')
    expect(list.status).toBe(200)
    const rows = (await list.json()) as RunSummary[]
    expect(rows.map((row) => row.id)).toContain(id)

    const misses = await app.request('/api/misses?layoutId=qwerty-ansi')
    expect(misses.status).toBe(200)
    expect(await misses.json()).toMatchObject({ letters: [], words: [], tests: 1 })
  })

  test('letters missed often enough are listed for that layout', async () => {
    const app = createApp(db)
    db.prepare(
      `INSERT INTO sessions (
         id, user_id, language_id, layout_id, geometry_id, mode, mode_value, drill_kind, drill_target,
         correction_policy, seed, wordlist_version, engine_version, target_text, started_at,
         duration_ms, completed, wpm, raw_wpm, accuracy, consistency,
         correct_chars, incorrect_chars, extra_chars, backspaces
       ) VALUES (
         'habit', 'local', 'en', 'qwerty-ansi', 'ansi', 'words', 25, NULL, NULL,
         'must_fix', 'habit', 'en-1', '1', 'e', '2026-10-22T12:00:00.000Z',
         10000, 1, 40, 40, 0.8, NULL, 16, 4, 0, 4
       )`,
    ).run()
    const insert = db.prepare(
      `INSERT INTO actions (
         session_id, seq, t_ms, kind, outcome, expected_char, produced_char, word_index, char_index, word,
         bigram, code, hand, finger, shift, iki_ms, hold_ms, flight_ms, is_hesitation, after_error
       ) VALUES (
         'habit', ?, ?, 'commit', ?, 'e', ?, 0, 0, 'e',
         NULL, 'KeyE', 'left', 'middle', 0, 100, NULL, NULL, 0, 0
       )`,
    )
    for (let i = 0; i < 20; i++) insert.run(i, i * 100, i < 4 ? 'incorrect' : 'correct', i < 4 ? 'r' : 'e')

    const response = await app.request('/api/misses?layoutId=qwerty-ansi')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      letters: [{ letter: 'e', attempts: 20, misses: 4, usual: 'r' }],
      words: [],
      tests: 1,
    })
  })

  test('a letter drill is saved and left out of the miss list', async () => {
    const app = createApp(db)
    let state = createTest(
      spec({ mode: 'drill', modeValue: 5, seed: 'letter-e', drill: { kind: 'letter', target: 'e' } }),
    )
    expect(state.words).toHaveLength(5)
    expect(state.words.every((word) => word.includes('e'))).toBe(true)
    state = typeWords(state)

    const response = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toSessionRequest(state, '2026-10-22T12:00:00.000Z')),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; coaching: { tests: number; focus: unknown } }
    expect(body.coaching.tests).toBe(0)
    expect(body.coaching.focus).toBeNull()

    const stored = get<{ mode: string; drill_kind: string; drill_target: string }>(
      db,
      'SELECT mode, drill_kind, drill_target FROM sessions WHERE id = ?',
      body.id,
    )
    expect(stored).toEqual({ mode: 'drill', drill_kind: 'letter', drill_target: 'e' })

    const misses = await app.request('/api/misses?layoutId=qwerty-ansi')
    expect(misses.status).toBe(200)
    expect(await misses.json()).toMatchObject({ letters: [], words: [], tests: 0 })
  })

  test('a word drill is saved and left out of the miss list', async () => {
    const app = createApp(db)
    let state = createTest(
      spec({ mode: 'drill', modeValue: 5, seed: 'word-finally', drill: { kind: 'word', target: 'finally' } }),
    )
    expect(state.words).toHaveLength(5)
    expect(state.words.filter((word) => word === 'finally')).toHaveLength(1)
    state = typeWords(state)

    const response = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toSessionRequest(state, '2026-10-22T12:00:00.000Z')),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; coaching: { tests: number; focus: unknown } }
    expect(body.coaching.tests).toBe(0)
    expect(body.coaching.focus).toBeNull()

    const stored = get<{ mode: string; drill_kind: string; drill_target: string }>(
      db,
      'SELECT mode, drill_kind, drill_target FROM sessions WHERE id = ?',
      body.id,
    )
    expect(stored).toEqual({ mode: 'drill', drill_kind: 'word', drill_target: 'finally' })

    const misses = await app.request('/api/misses?layoutId=qwerty-ansi')
    expect(await misses.json()).toMatchObject({ letters: [], words: [], tests: 0 })
    expect(all<{ id: string }>(db, 'SELECT id FROM focuses')).toHaveLength(0)
  })

  test('progress draws measured tests and does not open a focus', async () => {
    const app = createApp(db)
    const insertSession = db.prepare(
      `INSERT INTO sessions (
         id, user_id, language_id, layout_id, geometry_id, mode, mode_value, drill_kind, drill_target,
         correction_policy, seed, wordlist_version, engine_version, target_text, started_at,
         duration_ms, completed, wpm, raw_wpm, accuracy, consistency,
         correct_chars, incorrect_chars, extra_chars, backspaces
       ) VALUES (
         ?, 'local', 'en', 'qwerty-ansi', 'ansi', ?, 25, ?, ?,
         'must_fix', 'progress', 'en-1', '1', 'a', ?,
         10000, 1, ?, ?, 0.9, NULL, 10, 0, 0, 0
       )`,
    )
    insertSession.run('early', 'words', null, null, '2026-10-22T10:00:00.000Z', 30, 30)
    insertSession.run('later', 'words', null, null, '2026-10-22T11:00:00.000Z', 50, 50)
    insertSession.run('practiced', 'drill', 'letter', 'y', '2026-10-22T12:00:00.000Z', 99, 99)
    const insertAction = db.prepare(
      `INSERT INTO actions (
         session_id, seq, t_ms, kind, outcome, expected_char, produced_char, word_index, char_index, word,
         bigram, code, hand, finger, shift, iki_ms, hold_ms, flight_ms, is_hesitation, after_error
       ) VALUES (
         'later', ?, ?, 'commit', 'correct', 'a', 'a', 0, 0, 'a',
         NULL, 'KeyA', ?, ?, 0, ?, NULL, NULL, 0, 0
       )`,
    )
    for (let i = 0; i < 30; i++) insertAction.run(i, i * 100, 'left', 'pinky', 180)
    for (let i = 0; i < 30; i++) insertAction.run(30 + i, (30 + i) * 100, 'left', 'index', 100)

    const response = await app.request('/api/progress?layoutId=qwerty-ansi')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      points: { id: string; wpm: number }[]
      fingers: { target: string; medianMs: number | null; samples: number }[]
      runs: { id: string; drill: { kind: string; target: string } | null }[]
    }
    expect(body.points.map((point) => point.id)).toEqual(['early', 'later'])
    expect(body.points.map((point) => point.wpm)).toEqual([30, 50])
    expect(body.runs.map((run) => run.id)).toEqual(['practiced', 'later', 'early'])
    expect(body.runs[0]?.drill).toEqual({ kind: 'letter', target: 'y' })
    expect(body.runs[1]?.drill).toBeNull()
    expect(body.fingers.map((finger) => finger.target)[0]).toBe('left:pinky')
    expect(body.fingers.map((finger) => finger.target).at(-1)).toBe('right:pinky')
    expect(body.fingers.find((finger) => finger.target === 'left:pinky')).toMatchObject({ medianMs: 180, samples: 30 })
    expect(body.fingers.find((finger) => finger.target === 'left:index')).toMatchObject({ medianMs: 100, samples: 30 })
    expect(body.fingers.find((finger) => finger.target === 'right:pinky')?.medianMs).toBeNull()
    expect(all<{ id: string }>(db, 'SELECT id FROM focuses')).toHaveLength(0)
  })

  test('progress keeps the open focus and a focus that caught up', async () => {
    const app = createApp(db)
    const insertSession = db.prepare(
      `INSERT INTO sessions (
         id, user_id, language_id, layout_id, geometry_id, mode, mode_value, drill_kind, drill_target,
         correction_policy, seed, wordlist_version, engine_version, target_text, started_at,
         duration_ms, completed, wpm, raw_wpm, accuracy, consistency,
         correct_chars, incorrect_chars, extra_chars, backspaces
       ) VALUES (
         ?, 'local', 'en', 'qwerty-ansi', 'ansi', ?, 25, ?, ?,
         'must_fix', 'trace', 'en-1', '1', 'a', ?,
         10000, 1, 40, 40, 1, NULL, 10, 0, 0, 0
       )`,
    )
    insertSession.run('early', 'words', null, null, '2026-10-22T10:00:00.000Z')
    insertSession.run('later', 'words', null, null, '2026-10-22T11:00:00.000Z')
    insertSession.run('practiced', 'drill', 'bigram', 'ho', '2026-10-22T12:00:00.000Z')
    const insertAction = db.prepare(
      `INSERT INTO actions (
         session_id, seq, t_ms, kind, outcome, expected_char, produced_char, word_index, char_index, word,
         bigram, code, hand, finger, shift, iki_ms, hold_ms, flight_ms, is_hesitation, after_error
       ) VALUES (
         ?, ?, ?, 'commit', 'correct', 'o', 'o', 0, 1, 'ho',
         ?, 'KeyO', 'right', 'index', 0, ?, NULL, NULL, ?, 0
       )`,
    )
    insertAction.run('early', 0, 100, 'ho', 300, 0)
    insertAction.run('early', 1, 200, 'ho', 500, 0)
    insertAction.run('early', 2, 300, 'ho', 900, 1)
    insertAction.run('later', 0, 100, 'ho', 220, 0)
    insertAction.run('practiced', 0, 100, 'ho', 10, 0)
    db.prepare(
      `INSERT INTO focuses (
         id, user_id, layout_id, language_id, kind, target, opened_at, baseline_median_ms, baseline_samples,
         closed_at, closed_reason
       ) VALUES
         ('open-ho', 'local', 'qwerty-ansi', 'en', 'bigram', 'ho', '2026-10-22T10:00:00.000Z', 400, 8, NULL, NULL),
         ('old-bl', 'local', 'qwerty-ansi', 'en', 'bigram', 'bl', '2026-10-21T10:00:00.000Z', 300, 8, '2026-10-21T12:00:00.000Z', 'improved')`,
    ).run()

    const response = await app.request('/api/progress?layoutId=qwerty-ansi')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      trace: { kind: string; target: string; points: { id: string; medianMs: number }[] } | null
      caughtUp: { kind: string; target: string } | null
    }
    expect(body.trace).toEqual({
      kind: 'bigram',
      target: 'ho',
      points: [
        { id: 'early', startedAt: '2026-10-22T10:00:00.000Z', medianMs: 400 },
        { id: 'later', startedAt: '2026-10-22T11:00:00.000Z', medianMs: 220 },
      ],
    })
    expect(body.caughtUp).toEqual({ kind: 'bigram', target: 'bl' })
    expect(all<{ id: string }>(db, 'SELECT id FROM focuses WHERE closed_at IS NULL')).toHaveLength(1)
  })

  test('a focus that caught up is still the sentence when nothing else is open', async () => {
    const app = createApp(db)
    db.prepare(
      `INSERT INTO focuses (
         id, user_id, layout_id, language_id, kind, target, opened_at, baseline_median_ms, baseline_samples,
         closed_at, closed_reason
       ) VALUES (
         'old-ho', 'local', 'qwerty-ansi', 'en', 'bigram', 'ho', '2026-10-22T10:00:00.000Z', 400, 8,
         '2026-10-22T11:00:00.000Z', 'improved'
       )`,
    ).run()
    const response = await app.request('/api/coaching?layoutId=qwerty-ansi')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sentence: 'On QWERTY, "ho" has caught up. Nothing else stands out yet.',
      focus: null,
    })
  })

  test('a streak counts the days you typed, on either layout', async () => {
    const app = createApp(db)
    const insert = db.prepare(
      `INSERT INTO sessions (
         id, user_id, language_id, layout_id, geometry_id, mode, mode_value, drill_kind, drill_target,
         correction_policy, seed, wordlist_version, engine_version, target_text, started_at,
         duration_ms, completed, wpm, raw_wpm, accuracy, consistency,
         correct_chars, incorrect_chars, extra_chars, backspaces
       ) VALUES (
         ?, 'local', 'en', ?, 'ansi', ?, 25, ?, ?,
         'must_fix', 'streak', 'en-1', '1', 'a', ?,
         10000, 1, 40, 40, 1, NULL, 10, 0, 0, 0
       )`,
    )
    const noon = (dayOffset: number) =>
      new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + dayOffset, 12, 0, 0).toISOString()
    insert.run('today', 'dvorak-ansi', 'drill', 'letter', 'y', noon(0))
    insert.run('again-today', 'qwerty-ansi', 'words', null, null, noon(0))
    insert.run('yesterday', 'qwerty-ansi', 'words', null, null, noon(-1))
    insert.run('old-1', 'qwerty-ansi', 'words', null, null, noon(-10))
    insert.run('old-2', 'qwerty-ansi', 'words', null, null, noon(-9))
    insert.run('old-3', 'qwerty-ansi', 'words', null, null, noon(-8))

    const response = await app.request('/api/streak')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { current: number; longest: number; recent: { typed: boolean }[] }
    expect(body.current).toBe(2)
    expect(body.longest).toBe(3)
    expect(body.recent).toHaveLength(14)
    expect(body.recent.at(-1)?.typed).toBe(true)
    expect(body.recent.at(-2)?.typed).toBe(true)
  })

  test('an unknown test is not found', async () => {
    const app = createApp(db)
    const response = await app.request('/api/runs/missing')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'test was not found' })
  })
})

test('opening the database twice does not reapply the migration', () => {
  const file = path.join(os.tmpdir(), `dojc-${crypto.randomUUID()}.sqlite`)
  const first = openDatabase(file)
  const second = openDatabase(file)
  expect(get<{ n: number }>(second, 'SELECT COUNT(*) AS n FROM schema_migrations')?.n).toBe(3)
  expect(get<{ n: number }>(second, `SELECT COUNT(*) AS n FROM layouts`)?.n).toBe(2)
  first.close()
  second.close()
  fs.rmSync(file, { force: true })
  fs.rmSync(`${file}-wal`, { force: true })
  fs.rmSync(`${file}-shm`, { force: true })
})
