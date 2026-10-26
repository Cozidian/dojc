import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { GEOMETRY_ID, LANGUAGE_ID, WORDLIST_VERSION } from '@dojc/core'
import { LAYOUTS } from '@dojc/core'
import { PHYSICAL_KEYS } from '@dojc/core'
import { migrationsDir } from './paths.ts'

export const LOCAL_USER_ID = 'local'

export function all<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function get<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function transaction(db: DatabaseSync, run: () => void): void {
  db.exec('BEGIN')
  try {
    run()
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The connection may already have left the transaction.
    }
    throw error
  }
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  seed(db)
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set(all<{ id: string }>(db, 'SELECT id FROM schema_migrations').map((row) => row.id))
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    // A migration may rebuild a table that other tables reference. Foreign keys
    // have to be off before the transaction starts; SQLite ignores the pragma inside one.
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      transaction(db, () => {
        db.exec(sql)
        db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
      })
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }
}

function seed(db: DatabaseSync): void {
  transaction(db, () => {
    db.prepare(
      `INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    ).run(LOCAL_USER_ID, 'Local', new Date().toISOString())

    db.prepare(
      `INSERT INTO languages (id, name, wordlist_version) VALUES ('en', 'English', ?)
       ON CONFLICT (id) DO UPDATE SET wordlist_version = excluded.wordlist_version`,
    ).run(WORDLIST_VERSION)

    db.prepare(
      `INSERT INTO geometries (id, name) VALUES (?, 'ANSI')
       ON CONFLICT (id) DO NOTHING`,
    ).run(GEOMETRY_ID)

    db.prepare('DELETE FROM physical_keys WHERE geometry_id = ?').run(GEOMETRY_ID)
    const insertKey = db.prepare(
      `INSERT INTO physical_keys (geometry_id, code, row, col, hand, finger) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const key of PHYSICAL_KEYS) {
      insertKey.run(GEOMETRY_ID, key.code, key.row, key.col, key.hand, key.finger)
    }

    const insertLayout = db.prepare(
      `INSERT INTO layouts (id, name, language_id, geometry_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, language_id = excluded.language_id, geometry_id = excluded.geometry_id`,
    )
    const deleteBindings = db.prepare('DELETE FROM layout_keys WHERE layout_id = ?')
    const insertBinding = db.prepare(
      `INSERT INTO layout_keys (layout_id, code, unshifted, shifted) VALUES (?, ?, ?, ?)`,
    )
    for (const layout of Object.values(LAYOUTS)) {
      insertLayout.run(layout.id, layout.name, LANGUAGE_ID, layout.geometryId)
      deleteBindings.run(layout.id)
      for (const [code, binding] of Object.entries(layout.keys)) {
        insertBinding.run(layout.id, code, binding.unshifted, binding.shifted)
      }
    }
  })
}
