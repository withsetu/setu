import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// #1294: the site build validates the active theme's option declaration with parseThemeOptions —
// the check the API already runs — so a bad declaration stops `astro build` with a message naming
// the option, instead of a green build shipping a broken override while the admin's Appearance
// screen shows a 500 for the same theme.
const appDir = fileURLToPath(new URL('..', import.meta.url))
const fixtureTheme = fileURLToPath(
  new URL('./fixtures/theme-invalid-options', import.meta.url)
)

let result: { status: number | null; output: string }

beforeAll(() => {
  const run = spawnSync('pnpm', ['build'], {
    cwd: appDir,
    env: { ...process.env, SETU_TEST_THEME: fixtureTheme },
    encoding: 'utf8'
  })
  result = { status: run.status, output: `${run.stdout}\n${run.stderr}` }
}, 180_000)

describe('a malformed theme options declaration fails the build', () => {
  it('exits non-zero', () => {
    expect(result.status).not.toBe(0)
  })

  it('names the theme and the offending option', () => {
    expect(result.output).toContain('has an invalid options declaration')
    expect(result.output).toMatch(
      /option "headline": token must be a CSS custom property/
    )
  })
})
