import { runGitPortContract } from '@setu/git-testing'
import { createGitApi } from '@setu/api'
import { createMemoryGitPort } from '@setu/git-memory'
import { createHttpGitPort } from '../src/index'

// Contract-tests the HTTP adapter against the REAL api routes, in-process and
// portless: each case gets a fresh in-memory git + a fresh Hono app, and the
// adapter's fetch is wired straight to app.fetch (no network, no port). The
// test-only devDep on @setu/api (a package depending on an app) is intentional.
runGitPortContract(() => {
  const app = createGitApi(createMemoryGitPort(), () => ({
    id: 'local',
    role: 'admin'
  }))
  return createHttpGitPort({
    baseUrl: 'http://localhost',
    fetch: (input, init) =>
      Promise.resolve(app.fetch(new Request(input as string, init)))
  })
})
