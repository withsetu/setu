import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Brand color lives on --primary (shadcn's --accent is the neutral hover surface).
// Bespoke stylesheets must reference brand via var(--primary), never bare var(--accent).
// customize.css is intentionally excluded: its var(--accent) is the site-theme accent,
// overridden inline on the Appearance preview card.
const files = ['components.css', 'shell.css', 'editor.css']

describe('bespoke CSS uses --primary for brand, not bare --accent', () => {
  for (const f of files) {
    it(`${f} has no bare var(--accent)`, () => {
      const css = readFileSync(resolve(__dirname, `../src/styles/${f}`), 'utf8')
      expect(css).not.toMatch(/var\(--accent\)/)
    })
  }
})
