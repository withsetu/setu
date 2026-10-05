import { describe, it, expect } from 'vitest'
import { explainBuildFailure } from '../src/build-failure'

// The site's own #1118 refusal, imported rather than copied, so a reworded message there fails
// HERE instead of silently degrading the admin back to a bare exit code. A variable specifier
// keeps tsc from resolving a plain-JS module that has no declarations.
const SITE_URL_CHECK = new URL(
  '../../site/integrations/require-site-url.mjs',
  import.meta.url
).href
const { siteUrlProblem } = (await import(SITE_URL_CHECK)) as {
  siteUrlProblem: (
    command: string,
    raw: string | undefined
  ) => string | undefined
}

/** Roughly what `pnpm build` prints when the integration throws (captured from a real run). */
function astroTail(problem: string): string {
  return [
    '> @setu/site@0.0.0 build /srv/site',
    '> astro build',
    '',
    '[setu:require-site-url] An unhandled error occurred while running the "astro:config:setup" hook',
    problem,
    '  Location:',
    '    /srv/node_modules/astro/dist/integrations/hooks.js:56:21',
    '\u001b[31m ELIFECYCLE \u001b[39m Command failed with exit code 1.'
  ].join('\n')
}

describe('explainBuildFailure (#1183)', () => {
  it('names a missing SETU_SITE_URL instead of only the exit code', () => {
    const problem = siteUrlProblem('build', undefined)
    expect(problem).toBeDefined()
    const msg = explainBuildFailure(
      'build exited with code 1',
      astroTail(problem!)
    )
    expect(msg).toMatch(/SETU_SITE_URL is not set/)
    expect(msg).toMatch(/API server's environment/)
    // The raw cause stays, for whoever reads the job later.
    expect(msg).toMatch(/build exited with code 1/)
  })

  it('names a malformed SETU_SITE_URL, without echoing the value', () => {
    const problem = siteUrlProblem('build', 'www.example.com')
    expect(problem).toBeDefined()
    const msg = explainBuildFailure(
      'build exited with code 1',
      astroTail(problem!)
    )
    expect(msg).toMatch(/SETU_SITE_URL is not an absolute http\(s\) URL/)
    expect(msg).not.toMatch(/www\.example\.com"/)
  })

  it('sees through ANSI colour codes in the tail', () => {
    const problem = siteUrlProblem('build', '')!
    const coloured = `\u001b[31m${problem.replace(' is not set', '\u001b[39m is not set')}`
    expect(explainBuildFailure('build exited with code 1', coloured)).toMatch(
      /SETU_SITE_URL is not set/
    )
  })

  it('leaves an unrecognised failure exactly as it was', () => {
    expect(
      explainBuildFailure(
        'build exited with code 1',
        'Error: Cannot find module "x"'
      )
    ).toBe('build exited with code 1')
    expect(explainBuildFailure('build exited with code 1', undefined)).toBe(
      'build exited with code 1'
    )
  })

  it('does not match a tail that merely mentions the variable', () => {
    expect(
      explainBuildFailure(
        'build exited with code 1',
        'using SETU_SITE_URL=https://www.example.com\nTypeError: boom'
      )
    ).toBe('build exited with code 1')
  })
})
