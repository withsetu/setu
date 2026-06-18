import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createGitApi } from './app'

const dir = process.env.SAYTU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SAYTU_API_PORT ?? 4444)
const app = createGitApi(createLocalGitAdapter({ dir }))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir})`)
