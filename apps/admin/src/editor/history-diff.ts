import { parseMdoc } from '@setu/core'
import { diffWords } from 'diff'

/** One frontmatter field that differs between two revisions of an entry.
 *  `from`/`to` are display strings; `null` means the field is absent on that
 *  side (added or removed). */
export interface FieldChange {
  key: string
  from: string | null
  to: string | null
}

/** One word-level segment of the body diff, in document order. Exactly one of
 *  `added`/`removed` is true for changed segments; both false for unchanged. */
export interface BodySegment {
  value: string
  added: boolean
  removed: boolean
}

export interface MdocDiff {
  /** Changed frontmatter fields only — unchanged keys are omitted. */
  fields: FieldChange[]
  /** Word-level body segments, or null when the bodies are identical. */
  body: BodySegment[] | null
  /** True when neither frontmatter nor body differs. */
  identical: boolean
}

/** Render a frontmatter value legibly for a field row. YAML scalars arrive from
 *  js-yaml as strings/numbers/booleans/Dates; lists of scalars are the common
 *  taxonomy shape (tags/categories) — join them like the chips the editor
 *  shows. Anything deeper falls back to compact JSON, never
 *  "[object Object]". */
function display(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null))
    return v.map((x) => display(x)).join(', ')
  if (v === undefined) return ''
  return JSON.stringify(v)
}

/** Diff two serialized `.mdoc` revisions (#466): frontmatter as labeled field
 *  changes (via the canonical `parseMdoc` — never throws, malformed YAML falls
 *  back to body-only, so this can't crash on a historical revision with a bad
 *  fence), body as a word-level prose diff (jsdiff `diffWords`).
 *
 *  Direction: `oldRaw` is the selected (earlier) revision, `newRaw` the current
 *  one — added segments are what the current version gained since that
 *  revision, matching the WordPress revisions reading order. */
export function diffMdoc(oldRaw: string, newRaw: string): MdocDiff {
  const oldDoc = parseMdoc(oldRaw)
  const newDoc = parseMdoc(newRaw)

  const keys = [...Object.keys(oldDoc.frontmatter)]
  for (const k of Object.keys(newDoc.frontmatter))
    if (!keys.includes(k)) keys.push(k)

  const fields: FieldChange[] = []
  for (const key of keys) {
    const from =
      key in oldDoc.frontmatter ? display(oldDoc.frontmatter[key]) : null
    const to =
      key in newDoc.frontmatter ? display(newDoc.frontmatter[key]) : null
    if (from !== to) fields.push({ key, from, to })
  }

  const body =
    oldDoc.body === newDoc.body
      ? null
      : diffWords(oldDoc.body, newDoc.body).map((c) => ({
          value: c.value,
          added: Boolean(c.added),
          removed: Boolean(c.removed)
        }))

  return { fields, body, identical: fields.length === 0 && body === null }
}
