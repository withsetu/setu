import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// The integration is plain ESM; import its exported helpers directly (css-purge.test.ts pattern).
import {
  emitDefaultHeaders,
  mediaOriginFor
} from '../integrations/security-headers.mjs'

const appDir = fileURLToPath(new URL('..', import.meta.url))

describe('mediaOriginFor (#289)', () => {
  it('returns the media origin when it differs from the site origin', () => {
    expect(
      mediaOriginFor('https://media.example.com/media', 'https://example.com')
    ).toBe('https://media.example.com')
  })
  it('returns undefined when media is same-origin with the site', () => {
    expect(
      mediaOriginFor('https://example.com/media', 'https://example.com')
    ).toBeUndefined()
  })
  it('returns undefined for a relative media path (same-origin by definition)', () => {
    expect(mediaOriginFor('/media', 'https://example.com')).toBeUndefined()
  })
  it('returns undefined when unset', () => {
    expect(mediaOriginFor(undefined, 'https://example.com')).toBeUndefined()
    expect(mediaOriginFor('', 'https://example.com')).toBeUndefined()
  })
})

describe('emitDefaultHeaders (#289)', () => {
  const tmp: string[] = []
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'setu-headers-'))
    tmp.push(d)
    return d
  }
  afterAll(() => {
    for (const d of tmp) rmSync(d, { recursive: true, force: true })
  })

  it('writes the default _headers file into dist', async () => {
    const dist = dir()
    const wrote = await emitDefaultHeaders(dist, {})
    expect(wrote).toBe(true)
    const file = readFileSync(join(dist, '_headers'), 'utf8')
    expect(file.startsWith('/*\n')).toBe(true)
    expect(file).toContain('  X-Content-Type-Options: nosniff\n')
  })

  it('does NOT clobber a user-supplied _headers (theirs wins), and says so', async () => {
    const dist = dir()
    writeFileSync(join(dist, '_headers'), '/*\n  X-My-Header: custom\n')
    const logged: string[] = []
    const wrote = await emitDefaultHeaders(dist, {
      logger: { info: (m: string) => logged.push(m) }
    })
    expect(wrote).toBe(false)
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toBe(
      '/*\n  X-My-Header: custom\n'
    )
    expect(logged.join('\n')).toContain('user _headers present')
  })

  it('threads mediaOrigin into the CSP img-src', async () => {
    const dist = dir()
    await emitDefaultHeaders(dist, { mediaOrigin: 'https://cdn.example.com' })
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toContain(
      "img-src 'self' data: https://cdn.example.com;"
    )
  })
})

// Real-build smoke: the wired integration emits dist/_headers on `astro build`. Reuses an
// existing dist when it already carries the artifact under test (embed-block.test.ts pattern —
// astro build empties dist first, so a present _headers always came from the latest build).
describe('security headers render-smoke (#289)', () => {
  let file = ''
  beforeAll(() => {
    if (!existsSync(join(appDir, 'dist', '_headers'))) {
      execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
    }
    file = readFileSync(join(appDir, 'dist', '_headers'), 'utf8')
  }, 180_000)

  it('the built site ships dist/_headers with the baseline set', () => {
    expect(file).toMatch(/^\/\*\n/)
    expect(file).toContain('  X-Content-Type-Options: nosniff\n')
    expect(file).toContain('  Strict-Transport-Security: max-age=31536000\n')
    expect(file).toContain('  X-Frame-Options: SAMEORIGIN\n')
    expect(file).toContain('  Content-Security-Policy-Report-Only: ')
  })

  it('never ships an ENFORCING CSP line (report-only by design until the settings toggle)', () => {
    expect(file).not.toMatch(/Content-Security-Policy:/)
  })
})
