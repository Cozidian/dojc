import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  COACHING,
  ENGINE_VERSION,
  GEOMETRY_ID,
  InputError,
  MISSES,
  caughtUpSentence,
  coach,
  fingerBars,
  focusTrace,
  layoutName,
  localDay,
  streakFrom,
  missHabits,
  replay,
  reviewRun,
  toCoachingSummary,
  isLayoutId,
  type HabitAction,
  type HabitAttempt,
  type MissList,
  type ReviewAction,
  type Progress,
  type RunDetail,
  type Streak,
  type RunSummary,
  type ActionSample,
  type Attempt,
  type CoachingSummary,
  type Drill,
  type InputEvent,
  type LayoutId,
  type OpenFocus,
  type SaveSessionRequest,
  type SpeedFocus,
  type SessionResult,
  type TestSpec,
} from '@dojc/core'
import { all, get, transaction, LOCAL_USER_ID } from './db.ts'
import { parseSaveRequest } from './parse.ts'

type SessionRow = {
  id: string
  layout_id: string
  mode: TestSpec['mode']
  mode_value: number
  drill_kind: Drill['kind'] | null
  drill_target: string | null
  seed: string
  target_text: string
}

type EventRow = {
  t_ms: number
  type: 'down' | 'up'
  code: string
  key: string
  shift: number
  shortcut: number
}

type FocusRow = {
  id: string
  kind: Drill['kind']
  target: string
  opened_at: string
  baseline_median_ms: number
  baseline_samples: number
}

type AttemptRow = {
  id: string
  started_at: string
  mode: Attempt['mode']
  completed: number
}

type ActionRow = {
  session_id: string
  kind: ActionSample['kind']
  outcome: string
  bigram: string | null
  hand: string | null
  finger: string | null
  iki_ms: number | null
  is_hesitation: number
  after_error: number
}

export type SavedSession = {
  id: string
  wpm: number
  rawWpm: number
  accuracy: number
  consistency: number | null
  coaching: CoachingSummary
}

const bit = (value: boolean) => (value ? 1 : 0)

export function saveSession(db: DatabaseSync, body: unknown, nowIso = new Date().toISOString()): SavedSession {
  const request = parseSaveRequest(body)
  const result = replay(request.spec, request.events)
  if (!result.completed) throw new InputError('test was not finished')
  const id = randomUUID()
  let coaching: CoachingSummary = { sentence: null, tests: 0, focus: null }
  transaction(db, () => {
    insertSession(db, id, request, result)
    insertEvents(db, id, request.events)
    insertActions(db, id, result)
    coaching = syncCoaching(db, request.spec.layoutId, nowIso)
  })
  return {
    id,
    wpm: result.wpm,
    rawWpm: result.rawWpm,
    accuracy: result.accuracy,
    consistency: result.consistency,
    coaching,
  }
}

type RunRow = {
  id: string
  started_at: string
  mode: RunSummary['mode']
  drill_kind: Drill['kind'] | null
  drill_target: string | null
  wpm: number
  accuracy: number
  consistency: number | null
  target_text?: string
}

function toRunSummary(row: RunRow): RunSummary {
  const drill =
    row.mode === 'drill' &&
    (row.drill_kind === 'bigram' ||
      row.drill_kind === 'finger' ||
      row.drill_kind === 'letter' ||
      row.drill_kind === 'word') &&
    row.drill_target
      ? { kind: row.drill_kind, target: row.drill_target }
      : null
  return {
    id: row.id,
    startedAt: row.started_at,
    mode: row.mode,
    drill,
    wpm: row.wpm,
    accuracy: row.accuracy,
    consistency: row.consistency,
  }
}

export function readRuns(db: DatabaseSync, layoutId: string): RunSummary[] {
  if (!isLayoutId(layoutId)) throw new InputError('unknown layout')
  return all<RunRow>(
    db,
    `SELECT id, started_at, mode, drill_kind, drill_target, wpm, accuracy, consistency
     FROM sessions
     WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND completed = 1
     ORDER BY started_at DESC, id DESC
     LIMIT ?`,
    LOCAL_USER_ID,
    layoutId,
    COACHING.trailingSessions,
  ).map(toRunSummary)
}

export function readProgress(db: DatabaseSync, layoutId: string): Progress {
  if (!isLayoutId(layoutId)) throw new InputError('unknown layout')
  const runs = readRuns(db, layoutId)
  const pointRows = all<{ id: string; started_at: string; wpm: number; accuracy: number }>(
    db,
    `SELECT id, started_at, wpm, accuracy
     FROM sessions
     WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND completed = 1 AND mode != 'drill'
     ORDER BY started_at DESC, id DESC
     LIMIT ?`,
    LOCAL_USER_ID,
    layoutId,
    COACHING.trailingSessions,
  )
  const points = pointRows.reverse().map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    wpm: row.wpm,
    accuracy: row.accuracy,
  }))
  const { attempts, actions } = loadSamples(db, layoutId)
  // The focus this call would open is thrown away. Progress never writes one.
  const coached = coach({
    attempts,
    actions,
    openFocus: null,
    layoutName: layoutName(layoutId),
    measurementTests: attempts.length,
    nowIso: new Date().toISOString(),
  })
  const open = speedFocus(db, layoutId, 'open')
  const improved = speedFocus(db, layoutId, 'improved')
  const subject = open ?? improved
  const caughtUp =
    open && improved && (open.kind !== improved.kind || open.target !== improved.target) ? improved : null
  const trace = subject ? { ...subject, points: focusTrace(attempts, actions, subject) } : null
  return { points, fingers: fingerBars(coached.fingers), runs, trace, caughtUp }
}

function speedFocus(db: DatabaseSync, layoutId: LayoutId, which: 'open' | 'improved'): SpeedFocus | null {
  const row =
    which === 'open'
      ? get<{ kind: string; target: string }>(
          db,
          `SELECT kind, target FROM focuses
           WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND closed_at IS NULL`,
          LOCAL_USER_ID,
          layoutId,
        )
      : get<{ kind: string; target: string }>(
          db,
          `SELECT kind, target FROM focuses
           WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND closed_reason = 'improved'
           ORDER BY closed_at DESC, id DESC
           LIMIT 1`,
          LOCAL_USER_ID,
          layoutId,
        )
  if (!row || (row.kind !== 'finger' && row.kind !== 'bigram')) return null
  return { kind: row.kind, target: row.target }
}

export function readStreak(db: DatabaseSync, now = new Date()): Streak {
  const rows = all<{ day: string | null }>(
    db,
    `SELECT DISTINCT date(started_at, 'localtime') AS day
     FROM sessions
     WHERE user_id = ? AND completed = 1`,
    LOCAL_USER_ID,
  )
  return streakFrom(
    rows.flatMap((row) => (row.day ? [row.day] : [])),
    localDay(now),
  )
}

export function readRun(db: DatabaseSync, id: string): RunDetail | null {
  const row = get<RunRow & { target_text: string }>(
    db,
    `SELECT id, started_at, mode, drill_kind, drill_target, wpm, accuracy, consistency, target_text
     FROM sessions
     WHERE id = ? AND user_id = ? AND completed = 1`,
    id,
    LOCAL_USER_ID,
  )
  if (!row) return null
  const actions = all<ReviewAction & { word_index: number; char_index: number | null; expected_char: string | null; produced_char: string | null }>(
    db,
    `SELECT word_index, kind, outcome, expected_char, produced_char, char_index
     FROM actions
     WHERE session_id = ?
     ORDER BY seq`,
    id,
  )
  return {
    ...toRunSummary(row),
    words: reviewRun(
      row.target_text.split(' '),
      actions.map((action) => ({
        wordIndex: action.word_index,
        kind: action.kind,
        outcome: action.outcome,
        expectedChar: action.expected_char,
        producedChar: action.produced_char,
        charIndex: action.char_index,
      })),
    ),
  }
}

export function readMisses(db: DatabaseSync, layoutId: string): MissList {
  if (!isLayoutId(layoutId)) throw new InputError('unknown layout')
  const attempts = all<{ id: string; started_at: string; mode: string; completed: number }>(
    db,
    `SELECT id, started_at, mode, completed
     FROM sessions
     WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND completed = 1 AND mode != 'drill'
     ORDER BY started_at DESC, id DESC
     LIMIT ?`,
    LOCAL_USER_ID,
    layoutId,
    MISSES.trailingSessions,
  )
  if (attempts.length === 0) return { letters: [], words: [], tests: 0 }
  const ids = attempts.map((row) => row.id)
  const actions = all<{
    session_id: string
    word_index: number
    word: string
    kind: string
    outcome: string
    expected_char: string | null
    produced_char: string | null
  }>(
    db,
    `SELECT session_id, word_index, word, kind, outcome, expected_char, produced_char
     FROM actions
     WHERE session_id IN (${ids.map(() => '?').join(',')})
       AND kind = 'commit'
       AND outcome IN ('correct', 'incorrect', 'extra')`,
    ...ids,
  )
  const habitAttempts: HabitAttempt[] = attempts.map((row) => ({
    sessionId: row.id,
    startedAt: row.started_at,
    mode: row.mode,
    completed: row.completed === 1,
  }))
  const habitActions: HabitAction[] = actions.map((row) => ({
    sessionId: row.session_id,
    wordIndex: row.word_index,
    word: row.word,
    kind: row.kind,
    outcome: row.outcome,
    expectedChar: row.expected_char,
    producedChar: row.produced_char,
  }))
  return missHabits({ attempts: habitAttempts, actions: habitActions })
}

export function readCoaching(db: DatabaseSync, layoutId: string, nowIso = new Date().toISOString()): CoachingSummary {
  if (!isLayoutId(layoutId)) throw new InputError('unknown layout')
  let coaching: CoachingSummary = { sentence: null, tests: 0, focus: null }
  transaction(db, () => {
    coaching = syncCoaching(db, layoutId, nowIso)
  })
  return coaching
}

export function rebuildSessions(db: DatabaseSync): number {
  const rows = all<SessionRow>(db, 'SELECT * FROM sessions')
  transaction(db, () => {
    for (const row of rows) {
      const events = all<EventRow>(db, 'SELECT * FROM key_events WHERE session_id = ? ORDER BY seq', row.id).map(toEvent)
      const result = replay(specFromRow(row), events, row.target_text.split(' '))
      db.prepare('DELETE FROM actions WHERE session_id = ?').run(row.id)
      insertActions(db, row.id, result)
      db.prepare(
        `UPDATE sessions SET
           engine_version = ?, duration_ms = ?, completed = ?, wpm = ?, raw_wpm = ?,
           accuracy = ?, consistency = ?, correct_chars = ?, incorrect_chars = ?,
           extra_chars = ?, backspaces = ?
         WHERE id = ?`,
      ).run(
        ENGINE_VERSION,
        result.durationMs,
        bit(result.completed),
        result.wpm,
        result.rawWpm,
        result.accuracy,
        result.consistency,
        result.correctChars,
        result.incorrectChars,
        result.extraChars,
        result.backspaces,
        row.id,
      )
    }
  })
  return rows.length
}

function loadSamples(db: DatabaseSync, layoutId: LayoutId): { attempts: Attempt[]; actions: ActionSample[] } {
  const attemptRows = all<AttemptRow>(
    db,
    `SELECT id, started_at, mode, completed
     FROM sessions
     WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND completed = 1 AND mode != 'drill'
     ORDER BY started_at DESC, id DESC
     LIMIT ?`,
    LOCAL_USER_ID,
    layoutId,
    COACHING.trailingSessions,
  )
  const attempts: Attempt[] = attemptRows.map((row) => ({
    sessionId: row.id,
    startedAt: row.started_at,
    mode: row.mode,
    completed: row.completed === 1,
  }))
  const actions = all<ActionRow>(
    db,
    `SELECT a.session_id, a.kind, a.outcome, a.bigram, a.hand, a.finger, a.iki_ms, a.is_hesitation, a.after_error
     FROM actions a
     WHERE a.session_id IN (
       SELECT id FROM sessions
       WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND completed = 1 AND mode != 'drill'
       ORDER BY started_at DESC, id DESC
       LIMIT ?
     )
     AND a.kind = 'commit' AND a.outcome IN ('correct', 'incorrect')`,
    LOCAL_USER_ID,
    layoutId,
    COACHING.trailingSessions,
  ).map<ActionSample>((row) => ({
    sessionId: row.session_id,
    kind: row.kind,
    outcome: row.outcome,
    bigram: row.bigram,
    hand: row.hand,
    finger: row.finger,
    ikiMs: row.iki_ms,
    isHesitation: row.is_hesitation === 1,
    afterError: row.after_error === 1,
  }))
  return { attempts, actions }
}

function syncCoaching(db: DatabaseSync, layoutId: LayoutId, nowIso: string): CoachingSummary {
  const openRow = get<FocusRow>(
    db,
    `SELECT id, kind, target, opened_at, baseline_median_ms, baseline_samples
     FROM focuses
     WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND closed_at IS NULL`,
    LOCAL_USER_ID,
    layoutId,
  )
  const openFocus: OpenFocus | null = openRow
    ? {
        id: openRow.id,
        kind: openRow.kind,
        target: openRow.target,
        openedAt: openRow.opened_at,
        baselineMedianMs: openRow.baseline_median_ms,
        baselineSamples: openRow.baseline_samples,
      }
    : null

  const { attempts, actions } = loadSamples(db, layoutId)
  const countRow = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM sessions
     WHERE user_id = ? AND layout_id = ? AND language_id = 'en' AND completed = 1 AND mode != 'drill'`,
    LOCAL_USER_ID,
    layoutId,
  )
  const result = coach({
    attempts,
    actions,
    openFocus,
    layoutName: layoutName(layoutId),
    measurementTests: countRow?.n ?? 0,
    nowIso,
  })

  if (result.closed) {
    if (!openRow) throw new Error('coaching closed a focus that is not open')
    db.prepare('UPDATE focuses SET closed_at = ?, closed_reason = ? WHERE id = ?').run(nowIso, result.closed.reason, openRow.id)
  }
  if (result.focus && result.focus.id == null) {
    db.prepare(
      `INSERT INTO focuses (
         id, user_id, layout_id, language_id, kind, target, opened_at, baseline_median_ms, baseline_samples
       ) VALUES (?, ?, ?, 'en', ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      LOCAL_USER_ID,
      layoutId,
      result.focus.kind,
      result.focus.target,
      result.focus.openedAt,
      result.focus.baselineMedianMs,
      result.focus.baselineSamples,
    )
  }
  const summary = toCoachingSummary(result)
  if (summary.sentence || summary.focus) return summary
  const improved = speedFocus(db, layoutId, 'improved')
  if (!improved) return summary
  return { ...summary, sentence: caughtUpSentence(layoutName(layoutId), improved.kind, improved.target) }
}

function insertSession(db: DatabaseSync, id: string, request: SaveSessionRequest, result: SessionResult): void {
  const spec = request.spec
  db.prepare(
    `INSERT INTO sessions (
       id, user_id, language_id, layout_id, geometry_id,
       mode, mode_value, drill_kind, drill_target, correction_policy,
       seed, wordlist_version, engine_version, target_text, started_at,
       duration_ms, completed, wpm, raw_wpm, accuracy, consistency,
       correct_chars, incorrect_chars, extra_chars, backspaces
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    LOCAL_USER_ID,
    spec.languageId,
    spec.layoutId,
    GEOMETRY_ID,
    spec.mode,
    spec.modeValue,
    spec.drill?.kind ?? null,
    spec.drill?.target ?? null,
    spec.correctionPolicy,
    spec.seed,
    result.wordlistVersion,
    result.engineVersion,
    result.targetText,
    request.startedAt,
    result.durationMs,
    bit(result.completed),
    result.wpm,
    result.rawWpm,
    result.accuracy,
    result.consistency,
    result.correctChars,
    result.incorrectChars,
    result.extraChars,
    result.backspaces,
  )
}

function insertEvents(db: DatabaseSync, sessionId: string, events: readonly InputEvent[]): void {
  const insert = db.prepare(
    `INSERT INTO key_events (session_id, seq, t_ms, type, code, key, shift, shortcut)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  events.forEach((event, seq) => {
    insert.run(sessionId, seq, event.tMs, event.type, event.code, event.key, bit(event.shift), bit(event.shortcut))
  })
}

function insertActions(db: DatabaseSync, sessionId: string, result: SessionResult): void {
  const insert = db.prepare(
    `INSERT INTO actions (
       session_id, seq, t_ms, kind, outcome, expected_char, produced_char, word_index, char_index, word,
       bigram, code, hand, finger, shift, iki_ms, hold_ms, flight_ms, is_hesitation, after_error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const action of result.actions) {
    insert.run(
      sessionId,
      action.seq,
      action.tMs,
      action.kind,
      action.outcome,
      action.expectedChar,
      action.producedChar,
      action.wordIndex,
      action.charIndex,
      action.word,
      action.bigram,
      action.code,
      action.hand,
      action.finger,
      bit(action.shift),
      action.ikiMs,
      action.holdMs,
      action.flightMs,
      bit(action.isHesitation),
      bit(action.afterError),
    )
  }
}

function specFromRow(row: SessionRow): TestSpec {
  if (!isLayoutId(row.layout_id)) throw new Error(`unknown layout ${row.layout_id}`)
  let drill: Drill | null = null
  if (row.mode === 'drill') {
    if (
      (row.drill_kind !== 'bigram' &&
        row.drill_kind !== 'finger' &&
        row.drill_kind !== 'letter' &&
        row.drill_kind !== 'word') ||
      !row.drill_target
    ) {
      throw new Error(`session ${row.id} has a broken drill`)
    }
    drill = { kind: row.drill_kind, target: row.drill_target }
  }
  return {
    languageId: 'en',
    layoutId: row.layout_id,
    mode: row.mode,
    modeValue: row.mode_value,
    seed: row.seed,
    drill,
    correctionPolicy: 'must_fix',
  }
}

function toEvent(row: EventRow): InputEvent {
  if (row.type !== 'down' && row.type !== 'up') throw new Error('bad stored event')
  return {
    tMs: row.t_ms,
    type: row.type,
    code: row.code,
    key: row.key,
    shift: row.shift === 1,
    shortcut: row.shortcut === 1,
  }
}
