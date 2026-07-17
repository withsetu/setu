export interface ControlMeta {
  name: string
  options?: string[]
  default?: unknown
  apiBase: string
  /** Open the media library for this control's prop name. */
  onPickMedia: (name: string) => void
  /** Render the control greyed-out/read-only — set when a `forcedWhen` rule holds
   *  (e.g. a video's muted switch while autoplay is on). */
  disabled?: boolean
}

export interface ControlProps {
  value: unknown
  onChange: (next: unknown) => void
  meta: ControlMeta
}

/** Controls receive `value: unknown` (it comes straight off frontmatter/config attrs).
 *  `String(value ?? fallback)` on a non-string `value` silently produces "[object
 *  Object]" — a real footgun typescript-eslint's `no-base-to-string` flags. In practice
 *  every control's value is either a string or absent, so a plain `typeof` guard is the
 *  correct (and type-safe) way to get the display string. */
export function toDisplayString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}
