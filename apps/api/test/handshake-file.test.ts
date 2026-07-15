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
import { writeHandshakeFile } from '../src/handshake-file'

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
