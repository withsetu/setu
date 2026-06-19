import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const app = new Hono()
app.route('/', createGitApi(createLocalGitAdapter({ dir })))
app.route('/', createPreviewApi())

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir})`)
