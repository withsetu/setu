import { describe, it, expect } from 'vitest'
import { SHORTCUTS, formatKeys, ariaKeyshortcuts } from '../src/editor/shortcuts'
import type { ShortcutGroup } from '../src/editor/shortcuts'

describe('formatKeys', () => {
  it('renders Mac glyphs (no separator)', () => {
    expect(formatKeys(['Mod', 'b'], true)).toBe('⌘B')
    expect(formatKeys(['Mod', 'Shift', 's'], true)).toBe('⌘⇧S')
    expect(formatKeys(['Alt', 'Shift', 'ArrowUp'], true)).toBe('⌥⇧↑')
  })
  it('renders PC labels joined by +', () => {
    expect(formatKeys(['Mod', 'b'], false)).toBe('Ctrl+B')
    expect(formatKeys(['Mod', 'Shift', 's'], false)).toBe('Ctrl+Shift+S')
    expect(formatKeys(['Alt', 'Shift', 'ArrowDown'], false)).toBe('Alt+Shift+↓')
  })
})

describe('ariaKeyshortcuts', () => {
  it('renders the W3C token form', () => {
    expect(ariaKeyshortcuts(['Mod', 'b'])).toBe('Meta+B')
    expect(ariaKeyshortcuts(['Mod', 'Shift', 's'])).toBe('Meta+Shift+S')
    expect(ariaKeyshortcuts(['Mod', 'k'])).toBe('Meta+K')
  })
})

describe('SHORTCUTS registry', () => {
  it('every entry has a label, non-empty keys, and a known group', () => {
    const groups: ShortcutGroup[] = ['Formatting', 'Links', 'Blocks', 'Help']
    for (const s of SHORTCUTS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.keys.length).toBeGreaterThan(0)
      expect(groups).toContain(s.group)
    }
  })
  it('includes the link shortcut Mod-k', () => {
    const link = SHORTCUTS.find((s) => s.id === 'link')
    expect(link?.keys).toEqual(['Mod', 'k'])
  })
})
