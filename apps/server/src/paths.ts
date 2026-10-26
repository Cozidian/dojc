import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const repoRoot = path.resolve(here, '../../..')
export const migrationsDir = path.resolve(here, '../migrations')
export const defaultDbPath = path.join(repoRoot, 'data', 'dojc.sqlite')
export const defaultWebRoot = path.join(repoRoot, 'apps', 'web', 'dist')
