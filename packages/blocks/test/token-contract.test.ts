import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'
import { BLOCK_TOKENS } from '../src/tokens'

// @vitest-environment node

const tokensCss = readFileSync(
  fileURLToPath(new URL('../src/tokens.css', import.meta.url)),
  'utf8'
)

describe('base tokens.css defines every contract token', () => {
  it.each(BLOCK_TOKENS.map((t) => t.name))('defines %s', (name) => {
    // matches e.g. "  --accent:" at a line start (a definition, not a var() read)
    expect(tokensCss).toMatch(new RegExp(`(^|\\n)\\s*${name}\\s*:`))
  })
})

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const cssFiles = globSync('**/*.css', { cwd: SRC }).filter(
  (f) => f !== 'tokens.css'
) // the base layer is allowed to define literals

const CONTRACT: Set<string> = new Set(BLOCK_TOKENS.map((t) => t.name))
// Structural neutrals a block may hardcode (text on a tinted fill, etc.)
const ALLOWED_LITERALS = new Set(['#fff', '#ffffff', '#000', '#000000'])

describe('block CSS obeys the token contract', () => {
  it.each(cssFiles)(
    '%s reads only contract tokens or --blk-* locals',
    (rel) => {
      const css = readFileSync(`${SRC}/${rel}`, 'utf8')
      // Strip comments first: doc comments (e.g. callout.css's header) can contain literal
      // "var(--x, fallback)" example text that would otherwise false-positive here.
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
      const reads = [...stripped.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)]
        .map((m) => m[1])
        .filter((n): n is string => n !== undefined)
      const undeclared = reads.filter(
        (n) => !CONTRACT.has(n) && !n.startsWith('--blk-')
      )
      expect(undeclared, `undeclared tokens in ${rel}`).toEqual([])
    }
  )

  it.each(cssFiles)('%s hardcodes no brand colors', (rel) => {
    const css = readFileSync(`${SRC}/${rel}`, 'utf8')
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const hex = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    const offending = hex.filter((h) => !ALLOWED_LITERALS.has(h.toLowerCase()))
    expect(offending, `hardcoded colors in ${rel}`).toEqual([])
  })
})
