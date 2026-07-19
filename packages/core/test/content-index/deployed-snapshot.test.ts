import { describe, expect, it } from 'vitest'
import type { DeployInfo } from '../../src/content-index/list-entries'
import {
  deployedSnapshotFor,
  listContentEntries
} from '../../src/content-index/list-entries'

/** `deployedSnapshotFor` decides live-vs-staged for EVERY content row and for the
 *  editor's lifecycle badge, and encodes four rules in three lines (#663). It had no
 *  direct test — the branches were only ever exercised transitively, and the `added`
 *  branch not at all. Table-driven over all four, plus an integration pass proving
 *  `listContentEntries` maps each snapshot to the expected `Lifecycle`. */

const PATH = 'content/post/en/a.mdoc'
const COMMITTED = `---\ntitle: A\n---\n\nbody\n`

describe('deployedSnapshotFor', () => {
  it('never deployed (deployedSha null) → null, whatever `changed` says', () => {
    const deploy: DeployInfo = {
      deployedSha: null,
      changed: [{ path: PATH, added: false }]
    }
    expect(deployedSnapshotFor(deploy, PATH, COMMITTED)).toBeNull()
    expect(deployedSnapshotFor(deploy, PATH, null)).toBeNull()
  })

  it('deployed and unchanged since → the committed content itself (live, no pending)', () => {
    const deploy: DeployInfo = { deployedSha: 'sha0', changed: [] }
    expect(deployedSnapshotFor(deploy, PATH, COMMITTED)).toBe(COMMITTED)
  })

  it('unchanged is decided per-path: another path changing does not touch this one', () => {
    const deploy: DeployInfo = {
      deployedSha: 'sha0',
      changed: [{ path: 'content/post/en/other.mdoc', added: true }]
    }
    expect(deployedSnapshotFor(deploy, PATH, COMMITTED)).toBe(COMMITTED)
  })

  it('added since the deploy → null (never on the live site → staged)', () => {
    const deploy: DeployInfo = {
      deployedSha: 'sha0',
      changed: [{ path: PATH, added: true }]
    }
    expect(deployedSnapshotFor(deploy, PATH, COMMITTED)).toBeNull()
  })

  it('modified since the deploy → a sentinel that is never equal to the committed content', () => {
    const deploy: DeployInfo = {
      deployedSha: 'sha0',
      changed: [{ path: PATH, added: false }]
    }
    const snap = deployedSnapshotFor(deploy, PATH, COMMITTED)
    expect(snap).not.toBeNull()
    expect(snap).not.toBe(COMMITTED)
    // The sentinel must parse as NON-hidden frontmatter, or `deriveLifecycle`
    // would read the live site as taken down instead of live-with-changes.
    expect(snap).not.toContain('published')
  })

  it('the modified sentinel is stable across calls and paths (one shared value)', () => {
    const deploy: DeployInfo = {
      deployedSha: 'sha0',
      changed: [
        { path: PATH, added: false },
        { path: 'content/post/en/b.mdoc', added: false }
      ]
    }
    expect(deployedSnapshotFor(deploy, PATH, COMMITTED)).toBe(
      deployedSnapshotFor(deploy, 'content/post/en/b.mdoc', 'other')
    )
  })
})

describe('listContentEntries maps each deployed snapshot to a Lifecycle', () => {
  const ref = { collection: 'post', locale: 'en', slug: 'a' }
  const rowFor = (deploy: DeployInfo) =>
    listContentEntries({
      drafts: [],
      committed: [{ ref, content: COMMITTED }],
      deploy
    })[0]!

  it('never deployed → staged', () => {
    expect(rowFor({ deployedSha: null, changed: [] }).lifecycle).toEqual({
      state: 'staged'
    })
  })

  it('deployed, unchanged → live with no pending work', () => {
    expect(rowFor({ deployedSha: 'sha0', changed: [] }).lifecycle).toEqual({
      state: 'live'
    })
  })

  it('added since deploy → staged (not yet on the live site)', () => {
    expect(
      rowFor({
        deployedSha: 'sha0',
        changed: [{ path: PATH, added: true }]
      }).lifecycle
    ).toEqual({ state: 'staged' })
  })

  it('modified since deploy → live with pending staged changes', () => {
    expect(
      rowFor({
        deployedSha: 'sha0',
        changed: [{ path: PATH, added: false }]
      }).lifecycle
    ).toEqual({ state: 'live', pending: 'staged' })
  })

  it('modified since deploy to published:false → live, pending unpublishing', () => {
    const hidden = `---\ntitle: A\npublished: false\n---\n\nbody\n`
    const row = listContentEntries({
      drafts: [],
      committed: [{ ref, content: hidden }],
      deploy: { deployedSha: 'sha0', changed: [{ path: PATH, added: false }] }
    })[0]!
    expect(row.lifecycle).toEqual({ state: 'live', pending: 'unpublishing' })
  })
})
