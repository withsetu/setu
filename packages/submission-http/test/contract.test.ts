import { runSubmissionPortContract } from '@setu/db-testing'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import { createFormsApi } from '@setu/api'
import { createHttpSubmissionAdapter } from '../src/index'

// Wire the http adapter's fetch straight at the in-memory app (no network).
runSubmissionPortContract(() => {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({ submissions, captcha: { verify: async () => true } })
  const app = createFormsApi({ submit, submissions, resolveActor: () => ({ id: 'local', role: 'admin' }) })
  const fetchImpl = ((input: Request | string | URL, init?: RequestInit) =>
    app.fetch(new Request(typeof input === 'string' || input instanceof URL ? new URL(input, 'http://x').toString() : input, init))) as typeof fetch
  return createHttpSubmissionAdapter({ baseUrl: 'http://x', fetchImpl })
})
