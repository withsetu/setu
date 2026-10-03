import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { siteUrlProblem } from '../integrations/require-site-url.mjs'

const appDir = fileURLToPath(new URL('..', import.meta.url))

describe('siteUrlProblem (#1118)', () => {
  it('a build with SETU_SITE_URL unset or blank is refused, naming the variable', () => {
    for (const raw of [undefined, '', '   ']) {
      const msg = siteUrlProblem('build', raw)
      expect(msg).toMatch(/SETU_SITE_URL is not set/)
      expect(msg).toContain('http://localhost:4321')
    }
  })
  it('a build with a non-absolute or non-http(s) value is refused', () => {
    for (const raw of ['example.com', '/site', 'ftp://example.com'])
      expect(siteUrlProblem('build', raw)).toMatch(/absolute http\(s\) URL/)
  })
  it('a build with an absolute http(s) URL passes', () => {
    expect(siteUrlProblem('build', 'https://www.example.com')).toBeUndefined()
    expect(siteUrlProblem('build', 'http://localhost:4321')).toBeUndefined()
  })
  it('dev, sync and preview keep the localhost default (no check)', () => {
    for (const command of ['dev', 'sync', 'preview'] as const)
      expect(siteUrlProblem(command, undefined)).toBeUndefined()
  })
})

describe('a real astro build without SETU_SITE_URL', () => {
  it('fails, and says why', () => {
    const env = { ...process.env }
    delete env['SETU_SITE_URL']
    // `astro build` directly (not `pnpm build`): the gate fires in astro:config:setup, before any
    // page renders, so the prebuild codegen adds nothing to what this proves.
    const r = spawnSync('pnpm', ['exec', 'astro', 'build'], {
      cwd: appDir,
      env,
      encoding: 'utf8'
    })
    expect(r.status).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toContain('SETU_SITE_URL is not set')
  }, 120_000)
})
