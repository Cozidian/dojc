-- A test is replayable from key_events. actions is the transcript the engine
-- derived from those events, kept so coaching does not replay history on every read.
-- Rebuild deletes actions and writes them again. It does not touch key_events.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE languages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  wordlist_version TEXT NOT NULL
);

CREATE TABLE geometries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE physical_keys (
  geometry_id TEXT NOT NULL REFERENCES geometries(id),
  code TEXT NOT NULL,
  row INTEGER NOT NULL,
  col INTEGER NOT NULL,
  hand TEXT NOT NULL CHECK (hand IN ('left', 'right', 'thumb')),
  finger TEXT NOT NULL CHECK (finger IN ('pinky', 'ring', 'middle', 'index', 'thumb')),
  PRIMARY KEY (geometry_id, code)
);

CREATE TABLE layouts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language_id TEXT NOT NULL REFERENCES languages(id),
  geometry_id TEXT NOT NULL REFERENCES geometries(id)
);

CREATE TABLE layout_keys (
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  code TEXT NOT NULL,
  unshifted TEXT NOT NULL,
  shifted TEXT,
  PRIMARY KEY (layout_id, code)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  language_id TEXT NOT NULL REFERENCES languages(id),
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  geometry_id TEXT NOT NULL REFERENCES geometries(id),
  mode TEXT NOT NULL CHECK (mode IN ('words', 'time', 'drill')),
  mode_value INTEGER NOT NULL,
  drill_kind TEXT CHECK (drill_kind IN ('bigram', 'finger')),
  drill_target TEXT,
  correction_policy TEXT NOT NULL CHECK (correction_policy IN ('must_fix')),
  seed TEXT NOT NULL,
  wordlist_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  target_text TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  wpm REAL NOT NULL,
  raw_wpm REAL NOT NULL,
  accuracy REAL NOT NULL,
  consistency REAL,
  correct_chars INTEGER NOT NULL,
  incorrect_chars INTEGER NOT NULL,
  extra_chars INTEGER NOT NULL,
  backspaces INTEGER NOT NULL,
  CHECK (
    (mode = 'drill' AND drill_kind IS NOT NULL AND drill_target IS NOT NULL)
    OR (mode <> 'drill' AND drill_kind IS NULL AND drill_target IS NULL)
  )
);

CREATE TABLE key_events (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  t_ms REAL NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('down', 'up')),
  code TEXT NOT NULL,
  key TEXT NOT NULL,
  shift INTEGER NOT NULL CHECK (shift IN (0, 1)),
  shortcut INTEGER NOT NULL CHECK (shortcut IN (0, 1)),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE actions (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  t_ms REAL NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'backspace', 'reject')),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'correct', 'incorrect', 'extra',
    'deleted_correct', 'deleted_incorrect', 'deleted_extra',
    'rejected_space'
  )),
  expected_char TEXT,
  produced_char TEXT,
  word_index INTEGER NOT NULL,
  char_index INTEGER,
  word TEXT NOT NULL,
  bigram TEXT,
  code TEXT,
  hand TEXT CHECK (hand IS NULL OR hand IN ('left', 'right', 'thumb')),
  finger TEXT CHECK (finger IS NULL OR finger IN ('pinky', 'ring', 'middle', 'index', 'thumb')),
  shift INTEGER NOT NULL CHECK (shift IN (0, 1)),
  iki_ms REAL,
  hold_ms REAL,
  flight_ms REAL,
  is_hesitation INTEGER NOT NULL CHECK (is_hesitation IN (0, 1)),
  after_error INTEGER NOT NULL CHECK (after_error IN (0, 1)),
  PRIMARY KEY (session_id, seq)
);

-- One open focus per person, layout, and language. The path is a single thread.
CREATE TABLE focuses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  language_id TEXT NOT NULL REFERENCES languages(id),
  kind TEXT NOT NULL CHECK (kind IN ('bigram', 'finger')),
  target TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  baseline_median_ms REAL NOT NULL,
  baseline_samples INTEGER NOT NULL,
  closed_at TEXT,
  closed_reason TEXT CHECK (closed_reason IS NULL OR closed_reason IN ('improved', 'settled', 'stale'))
);

CREATE UNIQUE INDEX focuses_one_open
  ON focuses (user_id, layout_id, language_id)
  WHERE closed_at IS NULL;

CREATE INDEX sessions_coaching
  ON sessions (user_id, layout_id, language_id, completed, started_at);
