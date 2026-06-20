import { describe, it, expect, beforeEach } from 'vitest'
import { createReadService, tiptapToMarkdoc, markdocToTiptap, contentPath, serializeMdoc } from '../../src/index'
import type { DataPort, Draft, EntryRef, GitPort, Lock, TiptapDoc } from '../../src/index'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`
const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const author = { name: 'E', email: 'e@x.com' }

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

/** In-memory GitPort (files Map + incrementing sha + head). */
function fakeGit(): GitPort {
  const files = new Map<string, string>()
  let counter = 0
  let head: string | null = null
  const commitFiles: GitPort['commitFiles'] = async ({ changes }) => {
    let changed = false
    for (const ch of changes) {
      if ('delete' in ch) {
        if (files.delete(ch.path)) changed = true
      } else {
        files.set(ch.path, ch.content)
        changed = true
      }
    }
    if (!changed) return { sha: head ?? '' }
    head = `gitsha${++counter}`
    return { sha: head }
  }
  return {
    async headSha() {
      return head
    },
    async readFile(path) {
      return head === null ? null : files.get(path) ?? null
    },
    commitFile: (input) => commitFiles({ changes: [{ path: input.path, content: input.content }], message: input.message, author: input.author }),
    commitFiles,
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
  }
}

describe('createReadService.loadForEdit', () => {
  let data: DataPort
  let git: GitPort
  const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'hello' }
  const svc = () => createReadService({ data, git })

  beforeEach(() => {
    data = fakeData()
    git = fakeGit()
  })

  it('returns the existing live draft without forking', async () => {
    const seeded = await data.saveDraft({ ...ref, content: doc('wip'), metadata: { title: 'WIP' }, baseSha: 'sha0' })
    const r = await svc().loadForEdit(ref)
    expect(r).toEqual({ source: 'draft', draft: seeded })
  })

  it('returns absent when there is no draft and nothing published', async () => {
    expect(await svc().loadForEdit(ref)).toEqual({ source: 'absent' })
  })

  it('forks a draft from published Git content (baseSha = HEAD, empty metadata, persisted)', async () => {
    const md = tiptapToMarkdoc(doc('published body'))
    const { sha } = await git.commitFile({ path: contentPath(ref), content: md, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    expect(r.source).toBe('forked')
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(r.draft.content).toEqual(markdocToTiptap(md))
    expect(r.draft.metadata).toEqual({})
    expect(r.draft.baseSha).toBe(sha)
    expect((await svc().loadForEdit(ref)).source).toBe('draft')
  })

  it('round-trips body content through Git: tiptap → publish → open → tiptap', async () => {
    const original = doc('round trip me')
    const md = tiptapToMarkdoc(original)
    await git.commitFile({ path: contentPath(ref), content: md, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(tiptapToMarkdoc(r.draft.content)).toBe(md)
  })

  it('forks metadata from a published file with frontmatter', async () => {
    const file = serializeMdoc({ frontmatter: { title: 'Kept', status: 'published' }, body: tiptapToMarkdoc(doc('body')) })
    await git.commitFile({ path: contentPath(ref), content: file, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(r.draft.metadata).toEqual({ title: 'Kept', status: 'published' })
    expect(r.draft.content).toEqual(markdocToTiptap(tiptapToMarkdoc(doc('body'))))
  })

  it('round-trips content AND metadata through Git (publish shape → open)', async () => {
    const original = doc('full round trip')
    const metadata = { title: 'Round Trip', n: 3 }
    const file = serializeMdoc({ frontmatter: metadata, body: tiptapToMarkdoc(original) })
    await git.commitFile({ path: contentPath(ref), content: file, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(r.draft.metadata).toEqual(metadata)
    expect(tiptapToMarkdoc(r.draft.content)).toBe(tiptapToMarkdoc(original))
  })
})
