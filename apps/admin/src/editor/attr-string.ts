// Tiptap node attrs (`node.attrs.mdAttrs`, `attrs.tag`, …) round-trip Markdoc block
// attributes, which are `unknown` at the type level. `String(x ?? default)` on a
// non-string attr silently produces "[object Object]" instead of surfacing the bug —
// exactly what @typescript-eslint/no-base-to-string exists to catch (it fired on ~20
// call sites across editor/extensions/* + useSelectedBlock.ts). This is the shared,
// type-safe replacement: a real attr is always a string coming out of Markdoc/YAML
// frontmatter, so falling back on non-string is the correct, safe behavior.
export function attrString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Same coercion, but for optional attrs where "absent" should stay `undefined`
 *  rather than collapse to an empty-string fallback (e.g. optional Hero fields that
 *  fall back to a component default only when truly unset). */
export function attrStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
