import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { InputError } from '@dojc/core'
import { readCoaching, readMisses, readProgress, readRun, readRuns, readStreak, saveSession } from './store.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

export function createApp(db: DatabaseSync, webRoot?: string | null): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/coaching', (c) => {
    const layoutId = c.req.query('layoutId')
    if (!layoutId) throw new InputError('layout is missing')
    return c.json(readCoaching(db, layoutId))
  })

  app.get('/api/streak', (c) => c.json(readStreak(db)))

  app.get('/api/progress', (c) => {
    const layoutId = c.req.query('layoutId')
    if (!layoutId) throw new InputError('layout is missing')
    return c.json(readProgress(db, layoutId))
  })

  app.get('/api/runs', (c) => {
    const layoutId = c.req.query('layoutId')
    if (!layoutId) throw new InputError('layout is missing')
    return c.json(readRuns(db, layoutId))
  })

  app.get('/api/runs/:id', (c) => {
    const run = readRun(db, c.req.param('id'))
    if (!run) return c.json({ error: 'test was not found' }, 404)
    return c.json(run)
  })

  app.get('/api/misses', (c) => {
    const layoutId = c.req.query('layoutId')
    if (!layoutId) throw new InputError('layout is missing')
    return c.json(readMisses(db, layoutId))
  })

  app.post('/api/sessions', async (c) => {
    const body = await c.req.json()
    return c.json(saveSession(db, body))
  })

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  if (webRoot) app.all('*', (c) => serveWeb(c.req.path, webRoot))

  app.onError((error, c) => {
    if (error instanceof InputError) return c.json({ error: error.message }, 400)
    console.error(error)
    return c.json({ error: 'the dojo hit an unexpected error' }, 500)
  })

  return app
}

async function serveWeb(requestPath: string, webRoot: string): Promise<Response> {
  const root = path.resolve(webRoot)
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
  const file = path.resolve(root, relative)
  const inside = file === root || file.startsWith(root + path.sep)
  if (!inside) return text('not found', 404)
  try {
    const data = await fs.readFile(file)
    return new Response(data, { headers: { 'content-type': typeFor(file) } })
  } catch {
    if (relative.startsWith('assets/')) return text('not found', 404)
    try {
      const html = await fs.readFile(path.join(root, 'index.html'))
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    } catch {
      return text('not found', 404)
    }
  }
}

function typeFor(file: string): string {
  return TYPES[path.extname(file)] ?? 'application/octet-stream'
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
