import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8')

describe('tokens.css — shadcn standard vocabulary', () => {
  it('defines the core standard tokens', () => {
    for (const t of [
      '--background',
      '--foreground',
      '--card',
      '--popover',
      '--primary',
      '--secondary',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--destructive',
      '--border',
      '--input',
      '--ring',
      '--radius'
    ]) {
      expect(css, `missing ${t}`).toContain(`${t}:`)
    }
  })
  it('defines the success/warning/info state trio', () => {
    for (const t of [
      '--success',
      '--warning',
      '--info',
      '--success-foreground',
      '--warning-foreground',
      '--info-foreground'
    ]) {
      expect(css, `missing ${t}`).toContain(`${t}:`)
    }
  })
  it('keeps temporary back-compat aliases so bespoke CSS still renders', () => {
    for (const a of ['--bg:', '--surface:', '--text:', '--radius-base:']) {
      expect(css, `missing alias ${a}`).toContain(a)
    }
  })
  it('maps brand indigo to --primary (NOT --accent)', () => {
    // brand color #4f46e5 should appear on --primary; --accent is the neutral hover token
    expect(css).toMatch(/--primary:\s*#4f46e5/)
  })
})
