import { ENGINE_VERSION } from '@dojc/core'
import { openDatabase } from './db.ts'
import { defaultDbPath } from './paths.ts'
import { rebuildSessions } from './store.ts'

const db = openDatabase(process.env.DB_PATH ?? defaultDbPath)
const count = rebuildSessions(db)
console.log(`rebuilt ${count} sessions with engine ${ENGINE_VERSION}`)
db.close()
