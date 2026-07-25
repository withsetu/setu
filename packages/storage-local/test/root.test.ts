import { describe, it, expect } from 'vitest'
import { isInsideRoot, rootOf, rootPrefix } from '../src/root'
import { createLocalStorage } from '../src/index'

const bytes = (s: string) => new TextEncoder().encode(s)

/** #914: `rootOf` was `stripTrailingSlashes(normalize(dir))` with a `'' → normalize(dir)`
 *  fallback, which reproduced the very `//` bug #896 fixed whenever the strip emptied the
 *  string — and its strip only knew char code 47, so every win32 separator survived it. */
describe('rootOf', () => {
  it('collapses a run of trailing separators', () => {
    expect(rootOf('/var/media///', '/')).toBe('/var/media')
  })

  it('keeps the filesystem root as a single separator, not the empty string', () => {
    expect(rootOf('/', '/')).toBe('/')
    expect(rootOf('///', '/')).toBe('/')
  })

  // The reason this file parameterises `separator` at all: `sep` is fixed to '/' on every
  // machine this repo's CI runs on, so a win32-shaped dir is otherwise untestable here.
  // POSIX `normalize` leaves 'C:\\media\\' untouched (a backslash is an ordinary char),
  // which is exactly the string win32 `normalize` would hand the strip.
  it('strips a backslash separator too, so a win32-shaped dir does not keep it', () => {
    expect(rootOf('C:\\media\\', '\\')).toBe('C:\\media')
    expect(rootOf('C:\\media\\\\', '\\')).toBe('C:\\media')
  })

  it('leaves a dir with no trailing separator alone', () => {
    expect(rootOf('/var/media', '/')).toBe('/var/media')
  })
})

describe('rootPrefix', () => {
  it('appends the separator to an ordinary root', () => {
    expect(rootPrefix('/var/media', '/')).toBe('/var/media/')
    expect(rootPrefix('C:\\media', '\\')).toBe('C:\\media\\')
  })

  it('does not double the separator on the filesystem root', () => {
    expect(rootPrefix('/', '/')).toBe('/')
    expect(rootPrefix('C:\\', '\\')).toBe('C:\\')
  })
})

/** The containment backstop. Deleting its call site in `resolveKey` left the whole suite
 *  green (kill-shot, #914) because every key that could fail it is already rejected by the
 *  absolute/`..` guard above it — so it is tested here, directly, where it CAN fail. */
describe('isInsideRoot', () => {
  it('accepts the root itself and paths inside it', () => {
    expect(isInsideRoot('/var/media', '/var/media', '/')).toBe(true)
    expect(isInsideRoot('/var/media', '/var/media/a/b.png', '/')).toBe(true)
    expect(isInsideRoot('/', '/a/b.png', '/')).toBe(true)
  })

  it('rejects a sibling whose name merely starts with the root', () => {
    expect(isInsideRoot('/var/media', '/var/mediaX/b.png', '/')).toBe(false)
  })

  it('rejects a path outside the root entirely', () => {
    expect(isInsideRoot('/var/media', '/etc/passwd', '/')).toBe(false)
    expect(isInsideRoot('/var/media', '/var/escape.txt', '/')).toBe(false)
  })

  it('applies the same rules with a win32 separator', () => {
    expect(isInsideRoot('C:\\media', 'C:\\media\\a.png', '\\')).toBe(true)
    expect(isInsideRoot('C:\\media', 'C:\\mediaX\\a.png', '\\')).toBe(false)
  })
})

/** The `//` symptom end-to-end: every key was rejected as a traversal, which is how #896
 *  presented (total media failure reported as a security error). */
describe('storage-local with dir = the filesystem root', () => {
  // Read-only calls only: a `put` here would write to '/' for real.
  const s = createLocalStorage({ dir: '/', baseUrl: '/u' })

  it('does not reject an ordinary key as a path traversal', async () => {
    await expect(s.exists('setu-nonexistent-probe/x.png')).resolves.toBe(false)
    await expect(s.get('setu-nonexistent-probe/x.png')).resolves.toBeNull()
  })

  it('still rejects traversal keys', async () => {
    await expect(
      s.put('../escape.txt', bytes('x'), { contentType: 'text/plain' })
    ).rejects.toThrow()
    await expect(
      s.put('/etc/passwd', bytes('x'), { contentType: 'text/plain' })
    ).rejects.toThrow()
    await expect(s.get('a/../../b')).rejects.toThrow()
  })
})
