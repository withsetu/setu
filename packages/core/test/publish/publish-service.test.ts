import { describe, it, expect, beforeEach } from 'vitest'
import { createPublishService, tiptapToMarkdoc } from '../../src/index'
import type {
  CommitInput,
  DataPort,
  Draft,
  EntryRef,
  GitPort,
  Lock,
  TiptapDoc,
} from '../../src/index'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`
const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Minimal in-memory DataPort (full interface). */
function fakeData(): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  return {
    async getDraft(ref) {
      return drafts.get(key(ref)) ?? null
    },
    async saveDraft(input) {
      const k = key(input)
      const existing = drafts.get(k)
      const d: Draft = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
        content: input.content,
        metadata: input.metadata,
        baseSha: input.baseSha ?? null,
        createdAt: existing?.createdAt ?? 0,
        updatedAt: 0,
      }
      drafts.set(k, d)
      return d
    },
    async deleteDraft(ref) {
      drafts.delete(key(ref))
    },
    async listDrafts(filter) {
      const all = [...drafts.values()]
      return filter?.collection ? all.filter((d) => d.collection === filter.collection) : all
    },
    async getLock(ref) {
      return locks.get(key(ref)) ?? null
    },
    async putLock(lock) {
      locks.set(key(lock), { ...lock })
    },
    async deleteLock(ref) {
      locks.delete(key(ref))
    },
    async close() {},
  }
}

/** In-memory GitPort that also records commits, for message assertions. */
interface RecordingGit extends GitPort {
  commits: CommitInput[]
}
function fakeGit(): RecordingGit {
  const files = new Map<string, string>()
  const commits: CommitInput[] = []
  let counter = 0
  let head: string | null = null
  return {
    commits,
    async headSha() {
      return head
    },
    async readFile(path) {
      return head === null ? null : files.get(path) ?? null
    },
    async commitFile(input) {
      commits.push(input)
      files.set(input.path, input.content)
      head = `gitsha${++counter}`
      return { sha: head }
    },
  }
}

describe('createPublishService', () => {
  let data: DataPort
  let git: RecordingGit
  const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'hello' }
  const author = { name: 'Ed', email: 'ed@x.com' }
  const svc = () => createPublishService({ data, git })

  beforeEach(() => {
    data = fakeData()
    git = fakeGit()
  })

  it('returns nothing when there is no draft (git untouched)', async () => {
    const r = await svc().publish({ ref, author })
    expect(r).toEqual({ status: 'nothing' })
    expect(await git.headSha()).toBeNull()
  })

  it('first publish commits the compiled markdoc and advances baseSha', async () => {
    await data.saveDraft({ ...ref, content: doc('hi'), metadata: { title: 'T' } })
    const r = await svc().publish({ ref, author })
    expect(r.status).toBe('published')
    if (r.status !== 'published') throw new Error('unreachable')
    expect(r.path).toBe('content/post/en/hello.mdoc')
    expect(r.sha).toBe('gitsha1')
    expect(await git.readFile(r.path)).toBe(tiptapToMarkdoc(doc('hi')))
    expect((await data.getDraft(ref))?.baseSha).toBe('gitsha1')
  })

  it('republish after an edit does not falsely conflict', async () => {
    await data.saveDraft({ ...ref, content: doc('v1'), metadata: {} })
    expect((await svc().publish({ ref, author })).status).toBe('published')
    const cur = (await data.getDraft(ref))!
    expect(cur.baseSha).toBe('gitsha1')
    await data.saveDraft({ ...ref, content: doc('v2'), metadata: {}, baseSha: cur.baseSha })
    const second = await svc().publish({ ref, author })
    expect(second.status).toBe('published')
    if (second.status !== 'published') throw new Error('unreachable')
    expect(second.sha).toBe('gitsha2')
    expect(await git.readFile(second.path)).toBe(tiptapToMarkdoc(doc('v2')))
  })

  it('blocks with conflict when the repo advanced since the draft forked', async () => {
    await git.commitFile({ path: 'other.mdoc', content: 'x', message: 'm', author })
    await data.saveDraft({ ...ref, content: doc('mine'), metadata: {}, baseSha: 'stale-sha' })
    const r = await svc().publish({ ref, author })
    expect(r).toEqual({ status: 'conflict', baseSha: 'stale-sha', headSha: 'gitsha1' })
    expect(await git.readFile('content/post/en/hello.mdoc')).toBeNull()
    expect((await data.getDraft(ref))?.baseSha).toBe('stale-sha')
  })

  it('blocks a new entry (null baseSha) whose target file already exists', async () => {
    // external commit creates the SAME file this draft targets
    await git.commitFile({ path: 'content/post/en/hello.mdoc', content: 'existing', message: 'm', author })
    await data.saveDraft({ ...ref, content: doc('mine'), metadata: {} }) // baseSha null
    const r = await svc().publish({ ref, author })
    expect(r).toEqual({ status: 'conflict', baseSha: null, headSha: 'gitsha1' })
    expect(await git.readFile('content/post/en/hello.mdoc')).toBe('existing') // not clobbered
  })

  it('publishes a new entry into a repo that has unrelated content', async () => {
    await git.commitFile({ path: 'content/post/en/other.mdoc', content: 'x', message: 'm', author }) // head gitsha1
    await data.saveDraft({ ...ref, content: doc('new'), metadata: {} }) // baseSha null, target file absent
    const r = await svc().publish({ ref, author })
    expect(r.status).toBe('published')
    if (r.status !== 'published') throw new Error('unreachable')
    expect(await git.readFile('content/post/en/hello.mdoc')).toBe(tiptapToMarkdoc(doc('new')))
  })

  it('uses a default commit message and passes a custom one through', async () => {
    await data.saveDraft({ ...ref, content: doc('a'), metadata: {} })
    await svc().publish({ ref, author })
    expect(git.commits.at(-1)?.message).toBe('Publish post/en/hello')

    const ref2: EntryRef = { collection: 'post', locale: 'en', slug: 'two' }
    await data.saveDraft({ ...ref2, content: doc('b'), metadata: {} })
    await svc().publish({ ref: ref2, author, message: 'custom msg' })
    expect(git.commits.at(-1)?.message).toBe('custom msg')
  })
})
