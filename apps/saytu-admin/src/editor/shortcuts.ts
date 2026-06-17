export type ShortcutGroup = 'Formatting' | 'Links' | 'Blocks' | 'Help'

export interface Shortcut {
  id: string
  label: string
  keys: string[]
  group: ShortcutGroup
}

/** Single source of truth for editor shortcuts — consumed by the tooltips and the
 *  cheat sheet so they can't drift. `keys` use tokens: Mod/Alt/Shift + a letter or
 *  ArrowUp/ArrowDown. Mark + block-move keys match the actual StarterKit/BlockActions
 *  bindings; the link key is the one we add (KeyboardShortcuts extension). */
export const SHORTCUTS: Shortcut[] = [
  { id: 'bold', label: 'Bold', keys: ['Mod', 'b'], group: 'Formatting' },
  { id: 'italic', label: 'Italic', keys: ['Mod', 'i'], group: 'Formatting' },
  { id: 'code', label: 'Inline code', keys: ['Mod', 'e'], group: 'Formatting' },
  { id: 'strike', label: 'Strikethrough', keys: ['Mod', 'Shift', 's'], group: 'Formatting' },
  { id: 'subscript', label: 'Subscript', keys: ['Mod', ','], group: 'Formatting' },
  { id: 'superscript', label: 'Superscript', keys: ['Mod', '.'], group: 'Formatting' },
  { id: 'link', label: 'Add or edit link', keys: ['Mod', 'k'], group: 'Links' },
  { id: 'moveUp', label: 'Move block up', keys: ['Alt', 'Shift', 'ArrowUp'], group: 'Blocks' },
  { id: 'moveDown', label: 'Move block down', keys: ['Alt', 'Shift', 'ArrowDown'], group: 'Blocks' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['Mod', '/'], group: 'Help' },
]

const MAC_GLYPH: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', ArrowUp: '↑', ArrowDown: '↓' }
const PC_LABEL: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', ArrowUp: '↑', ArrowDown: '↓' }

/** Render a shortcut for display, platform-aware. Mac uses adjacent glyphs (⌘⇧S);
 *  other platforms use `+`-joined labels (Ctrl+Shift+S). Pure. */
export function formatKeys(keys: string[], mac: boolean): string {
  const map = mac ? MAC_GLYPH : PC_LABEL
  const parts = keys.map((k) => map[k] ?? (k.length === 1 ? k.toUpperCase() : k))
  return mac ? parts.join('') : parts.join('+')
}

const ARIA: Record<string, string> = { Mod: 'Meta', Alt: 'Alt', Shift: 'Shift', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown' }

/** W3C `aria-keyshortcuts` token form, e.g. "Meta+Shift+S". Pure. */
export function ariaKeyshortcuts(keys: string[]): string {
  return keys.map((k) => ARIA[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join('+')
}

/** Best-effort Mac detection (browser only). */
export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac/i.test(navigator.platform || navigator.userAgent || '')
}
