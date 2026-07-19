import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createMemoryDataPort } from '@setu/db-memory'
import { contentPath, createRenameService } from '@setu/core'
import type { EntryRef } from '@setu/core'
import { createLocalGitAdapter } from '../src/index'

// #654 — the rename service's `target-exists` guard is `git.readFile(newPath)`, a BYTE-EXACT
// git-tree lookup, while the write is `fsp.writeFile`, i.e. the FILESYSTEM. On a case-FOLDING
// filesystem (APFS/NTFS) `ﬁle.mdoc` (U+FB01) and `file.mdoc` are the SAME INODE, so the guard
// misses and the rename OVERWRITES a different, published entry. Reproduced end-to-end: the
// victim's bytes were replaced and git HEAD still held the victim — index and working tree
// disagreed.
//
// This test uses the REAL local adapter on a REAL temp repo on purpose: the whole defect is a
// filesystem-vs-git-tree disagreement, which a mock git port cannot express (git-memory has no
// filesystem and therefore no folding).

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const author = { name: 'T', email: 't@x.com' }
const ref = (slug: string): EntryRef => ({
  collection: 'post',
  locale: 'en',
  slug
})
const mdoc = (title: string, body: string) =>
  `---\ntitle: ${title}\n---\n\n${body}\n`

const VICTIM = mdoc('Victim', 'VICTIM BODY')
const OTHER = mdoc('Other', 'OTHER BODY')

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'setu-rename-fold-'))
  dirs.push(dir)
  await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
  const gitPort = createLocalGitAdapter({ dir })
  await gitPort.commitFiles({
    changes: [
      { path: contentPath(ref('file')), content: VICTIM },
      { path: contentPath(ref('other')), content: OTHER }
    ],
    message: 'seed',
    author
  })
  const rename = createRenameService({
    data: createMemoryDataPort(),
    git: gitPort,
    author
  })
  return { dir, gitPort, rename }
}

/** Every fold-collision spelling of the published slug `file`/`settings` an attacker (or an
 *  unlucky paste) can reach: characters whose Unicode case FOLD lands on ASCII while
 *  `toLowerCase()` leaves them alone. */
const FOLD_COLLIDING_TARGETS = [
  'ﬁle', // U+FB01 LATIN SMALL LIGATURE FI  → folds to "file"
  'ﬁ' + 'le', // same, spelled out
  'ſile' // U+017F LATIN SMALL LETTER LONG S → folds to "sile" (fold-unstable class)
]

describe('renameSlug against the real git adapter — Unicode fold collision (#654)', () => {
  it('refuses a fold-colliding target instead of destroying the published entry', async () => {
    for (const target of FOLD_COLLIDING_TARGETS) {
      const { dir, rename } = await setup()
      const result = await rename.renameSlug(ref('other'), target)

      expect(result.renamed, `renamed for ${JSON.stringify(target)}`).toBe(
        false
      )

      // The kill-shot assertion: read the FILESYSTEM, not git. `git.readFile` resolves at HEAD
      // and would happily report the victim intact while the working tree had already been
      // clobbered (#623's lesson).
      const victimOnDisk = readFileSync(
        join(dir, contentPath(ref('file'))),
        'utf8'
      )
      expect(victimOnDisk, `victim bytes after ${JSON.stringify(target)}`).toBe(
        VICTIM
      )
      const otherOnDisk = readFileSync(
        join(dir, contentPath(ref('other'))),
        'utf8'
      )
      expect(otherOnDisk, `source bytes after ${JSON.stringify(target)}`).toBe(
        OTHER
      )
    }
  })

  it('still renames to an ordinary target, and the move lands on disk and in git', async () => {
    const { dir, gitPort, rename } = await setup()
    const result = await rename.renameSlug(ref('other'), 'moved')

    expect(result.renamed).toBe(true)
    expect(readFileSync(join(dir, contentPath(ref('moved'))), 'utf8')).toBe(
      OTHER
    )
    expect(existsSync(join(dir, contentPath(ref('other'))))).toBe(false)
    expect(await gitPort.readFile(contentPath(ref('moved')))).toBe(OTHER)
    // the untouched neighbour is exactly as seeded
    expect(await gitPort.readFile(contentPath(ref('file')))).toBe(VICTIM)
  })
})
