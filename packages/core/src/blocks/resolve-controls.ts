import type { ZodTypeAny } from 'zod'
import type { BlockControl } from '../config/types'
import { markdocAttributesFor } from './markdoc-attributes'

export interface ResolvedControl {
  name: string
  control: BlockControl
  default?: unknown
  options?: string[]
  /** Numeric bounds/step for number-backed controls (from zod .min/.max/.multipleOf). */
  min?: number
  max?: number
  step?: number
}

/** The zod-derived prop type each control may back. This single `Record<BlockControl, …>`
 *  is the source of truth the categorization sets below derive from — and because a Record
 *  keyed by a union is compile-exhaustive, adding a `BlockControl` member without classifying
 *  it here is a TYPE ERROR, not a silent gap that first surfaces as a misleading
 *  "hint incompatible with prop" throw at registry-build time (CLAUDE.md §4 #1/#14 class).
 *
 *  `String`  — a non-enum String prop. `category`/`tag` render a searchable taxonomy picker
 *              in the inspector but store a single slug string; `media` picks an image from
 *              the library; `video` picks a video file.
 *  `enum`    — a String prop with `.matches` (a fixed value set).
 *  `Number`  — a Number prop.
 *  `Boolean` — a Boolean prop (the zod-derived `switch`).
 *  `Array`   — an Array prop; there is no generic array editor, so an array prop MUST pick
 *              one of these explicitly (see the throw below). */
type ControlBacking = 'String' | 'enum' | 'Number' | 'Boolean' | 'Array'

const CONTROL_BACKING: Record<BlockControl, ControlBacking> = {
  text: 'String',
  textarea: 'String',
  media: 'String',
  video: 'String',
  url: 'String',
  color: 'String',
  category: 'String',
  tag: 'String',
  locale: 'String',
  select: 'enum',
  position9: 'enum',
  align: 'enum',
  number: 'Number',
  slider: 'Number',
  switch: 'Boolean',
  'media-list': 'Array'
}

const controlsBackedBy = (backing: ControlBacking): ReadonlySet<BlockControl> =>
  new Set(
    (Object.entries(CONTROL_BACKING) as [BlockControl, ControlBacking][])
      .filter(([, b]) => b === backing)
      .map(([control]) => control)
  )

/** String-backed controls a hint may upgrade a (non-enum) String prop to. */
const STRING_CONTROLS = controlsBackedBy('String')
/** Controls a hint may upgrade an enum (String with `.matches`) prop to. */
const ENUM_HINTS = controlsBackedBy('enum')
/** Controls a hint may upgrade a Number prop to. */
const NUMBER_HINTS = controlsBackedBy('Number')
/** Controls a hint may upgrade a Boolean prop to. */
const BOOLEAN_HINTS = controlsBackedBy('Boolean')
/** Controls valid for an Array prop. */
const ARRAY_HINTS = controlsBackedBy('Array')

/** Map a block's zod props (+ optional per-prop control hints) to an ordered list of
 *  controls for the inspector. Hints override the zod-derived control but must be
 *  type-compatible; an unknown prop or an incompatible hint throws (never silently lossy,
 *  mirroring markdocAttributesFor). */
export function resolveControls(
  props: ZodTypeAny,
  hints: Record<string, BlockControl> = {}
): ResolvedControl[] {
  const attrs = markdocAttributesFor(props)
  for (const prop of Object.keys(hints)) {
    if (!(prop in attrs))
      throw new Error(`resolveControls: hint for unknown prop "${prop}"`)
  }
  return Object.entries(attrs).map(([name, a]) => {
    // zod-derived default control
    const derived: BlockControl = a.matches
      ? 'select'
      : a.type === 'Number'
        ? 'number'
        : a.type === 'Boolean'
          ? 'switch'
          : 'text'
    const shared = {
      ...(a.default !== undefined ? { default: a.default } : {}),
      ...(a.matches ? { options: a.matches } : {}),
      ...(a.min !== undefined ? { min: a.min } : {}),
      ...(a.max !== undefined ? { max: a.max } : {}),
      ...(a.step !== undefined ? { step: a.step } : {})
    }
    const hint = hints[name]
    if (hint === undefined) {
      // No inspector control can render an arbitrary array — require an explicit,
      // type-compatible hint instead of silently falling back to a text box.
      if (a.type === 'Array')
        throw new Error(
          `resolveControls: array prop "${name}" needs an explicit control hint (e.g. 'media-list')`
        )
      return { name, control: derived, ...shared }
    }
    // a hint is only valid if compatible with the zod type
    const ok =
      (a.matches && ENUM_HINTS.has(hint)) ||
      (a.type === 'Number' && NUMBER_HINTS.has(hint)) ||
      (a.type === 'Boolean' && BOOLEAN_HINTS.has(hint)) ||
      (a.type === 'String' && !a.matches && STRING_CONTROLS.has(hint)) ||
      (a.type === 'Array' && ARRAY_HINTS.has(hint))
    if (!ok)
      throw new Error(
        `resolveControls: hint "${hint}" incompatible with prop "${name}" (zod ${a.type}${a.matches ? ' enum' : ''})`
      )
    return { name, control: hint, ...shared }
  })
}
