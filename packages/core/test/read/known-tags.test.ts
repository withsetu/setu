import { describe, it, expect } from 'vitest'
import { createReadService } from '../../src/read/read-service'
import type { DataPort } from '../../src/data/data-port'
import type { GitPort } from '../../src/git/git-port'

const ref = { collection: 'post', locale: 'en', slug: 'x' }
const mdoc = `---\ntitle: X\n---\n{% callout type="info" %}\nHi.\n{% /callout %}\n`

// Minimal stub ports: no draft, one published file, head sha, echo saveDraft.
function ports(): { data: DataPort; git: GitPort } {
  const data = {
    getDraft: async () => null,
    saveDraft: async (d: unknown) => ({ ...(d as object), id: '1' })
  } as unknown as DataPort
  const git = {
    readFile: async () => mdoc,
    headSha: async () => 'sha'
  } as unknown as GitPort
  return { data, git }
}

describe('read-service knownBlockTags injection', () => {
  it('treats callout as a block node when its tag is injected', async () => {
    const { data, git } = ports()
    const svc = createReadService({
      data,
      git,
      knownBlockTags: new Set(['callout'])
    })
    const res = await svc.loadForEdit(ref)
    const content = (
      res as { draft: { content: { content: Array<{ type: string }> } } }
    ).draft.content
    expect(content.content.some((n) => n.type === 'callout')).toBe(true)
  })
  it('falls back to passthrough when no tags are injected (default empty after Task 7)', async () => {
    const { data, git } = ports()
    const svc = createReadService({ data, git, knownBlockTags: new Set() })
    const res = await svc.loadForEdit(ref)
    const content = (
      res as { draft: { content: { content: Array<{ type: string }> } } }
    ).draft.content
    expect(content.content.some((n) => n.type === 'passthrough')).toBe(true)
  })
})
