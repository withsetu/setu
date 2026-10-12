import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handshakeFileName, writeHandshakeFile } from '../src/handshake-file'
// Plain JS outside the workspace graph: a non-literal specifier keeps tsc from resolving it.
const devLanes = new URL('../../../scripts/dev-lanes.mjs', import.meta.url).href
const { handshakeFileFor } = (await import(devLanes)) as {
  handshakeFileFor: (lane: string | undefined) => string
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handshake-file-'))
  dirs.push(dir)
  return dir
}

describe('writeHandshakeFile (#386)', () => {
  it('writes the URL + trailing newline to ${dir}/.setu/handshake-url', () => {
    const dir = makeDir()
    const url = 'http://localhost:5173/#setu-token=abc123'

    writeHandshakeFile(dir, url)

    const content = readFileSync(join(dir, '.setu', 'handshake-url'), 'utf-8')
    expect(content).toBe(`${url}\n`)
  })

  it('creates the file with mode 0600', () => {
    const dir = makeDir()

    writeHandshakeFile(dir, 'http://localhost:5173/#setu-token=abc123')

    const mode = statSync(join(dir, '.setu', 'handshake-url')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('overwrites a pre-existing looser file, replacing content AND tightening mode to 0600', () => {
    const dir = makeDir()
    mkdirSync(join(dir, '.setu'), { recursive: true })
    const file = join(dir, '.setu', 'handshake-url')
    // Simulate a stale file created before this feature (or by an older/looser writer):
    // writeFileSync's `mode` only applies at creation, so rewrite must chmod explicitly.
    writeFileSync(file, 'http://localhost:5173/#setu-token=stale-old-token\n', {
      mode: 0o644
    })
    expect(statSync(file).mode & 0o777).toBe(0o644)

    const url = 'http://localhost:5173/#setu-token=rotated-new-token'
    writeHandshakeFile(dir, url)

    expect(readFileSync(file, 'utf-8')).toBe(`${url}\n`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})

// #1213: `pnpm dev` lanes share one sandbox; each lane's api writes its own file, which the
// readers (scripts/auth-login-link.mjs, dev-status.mjs) find by the same lane name.
describe('per-lane handshake file (#1213)', () => {
  it('writes .setu/handshake-url.<lane> when given a lane, leaving other lanes alone', () => {
    const dir = makeDir()
    writeHandshakeFile(dir, 'http://localhost:5273/#setu-token=a', 'a')
    writeHandshakeFile(dir, 'http://localhost:5373/#setu-token=b', 'b')
    expect(readFileSync(join(dir, '.setu', 'handshake-url.a'), 'utf8')).toBe(
      'http://localhost:5273/#setu-token=a\n'
    )
    expect(readFileSync(join(dir, '.setu', 'handshake-url.b'), 'utf8')).toBe(
      'http://localhost:5373/#setu-token=b\n'
    )
    expect(statSync(join(dir, '.setu', 'handshake-url.a')).mode & 0o777).toBe(
      0o600
    )
  })

  it('refuses a lane name that is not a single safe segment', () => {
    for (const bad of ['../x', 'a/b', '.hidden', '-flag', ''])
      expect(() => handshakeFileName(bad)).toThrow(/invalid lane name/)
  })

  it('names the same file the dev scripts read', () => {
    for (const lane of [undefined, 'dev', 'feature-x'])
      expect(handshakeFileName(lane)).toBe(handshakeFileFor(lane))
  })
})
