import { describe, it, expect } from 'vitest'
import { deriveLifecycle } from '../../src/lifecycle/derive'

const body = (s: string) => `${s}\n`
const hidden = (s: string) => `---\npublished: false\n---\n${s}\n`

describe('deriveLifecycle', () => {
  it('draft-only (uncommitted, never deployed) → draft', () => {
    expect(
      deriveLifecycle({ draft: body('a'), committed: null, deployed: null })
    ).toEqual({ state: 'draft' })
  })
  it('committed, not deployed → staged', () => {
    expect(
      deriveLifecycle({
        draft: body('a'),
        committed: body('a'),
        deployed: null
      })
    ).toEqual({ state: 'staged' })
  })
  it('committed but newer uncommitted edits, not deployed → staged · edited', () => {
    expect(
      deriveLifecycle({
        draft: body('b'),
        committed: body('a'),
        deployed: null
      })
    ).toEqual({ state: 'staged', pending: 'edited' })
  })
  it('deployed == committed == draft → live', () => {
    expect(
      deriveLifecycle({
        draft: body('a'),
        committed: body('a'),
        deployed: body('a')
      })
    ).toEqual({ state: 'live' })
  })
  it('live with newer uncommitted edits → live · edited', () => {
    expect(
      deriveLifecycle({
        draft: body('b'),
        committed: body('a'),
        deployed: body('a')
      })
    ).toEqual({ state: 'live', pending: 'edited' })
  })
  it('live with newer committed (not yet deployed) → live · staged', () => {
    expect(
      deriveLifecycle({
        draft: body('b'),
        committed: body('b'),
        deployed: body('a')
      })
    ).toEqual({ state: 'live', pending: 'staged' })
  })
  it('unpublish committed over a live entry → live · unpublishing', () => {
    expect(
      deriveLifecycle({
        draft: hidden('a'),
        committed: hidden('a'),
        deployed: body('a')
      })
    ).toEqual({ state: 'live', pending: 'unpublishing' })
  })
  it('hidden + deployed → unpublished', () => {
    expect(
      deriveLifecycle({
        draft: hidden('a'),
        committed: hidden('a'),
        deployed: hidden('a')
      })
    ).toEqual({ state: 'unpublished' })
  })
})
