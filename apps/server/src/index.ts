import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { openDatabase } from './db.ts'
import { defaultDbPath, defaultWebRoot } from './paths.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)
const dbPath = process.env.DB_PATH ?? defaultDbPath
const webRoot = fs.existsSync(defaultWebRoot) ? defaultWebRoot : null
const db = openDatabase(dbPath)
const app = createApp(db, webRoot)

serve({ fetch: app.fetch, hostname: host, port }, () => {
  console.log(`dojc http://${host}:${port}`)
  console.log(`data ${dbPath}`)
})
