import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
