import type { ZodTypeAny } from 'zod'
import type { BlockControl } from '../config/types'
import { markdocAttributesFor } from './markdoc-attributes'

export interface ResolvedControl {
  name: string
  control: BlockControl
  default?: unknown
  options?: string[]
}

/** String-backed controls a hint may upgrade a String prop to. */
const STRING_CONTROLS: ReadonlySet<BlockControl> = new Set(['text', 'textarea', 'media', 'url', 'color'])

/** Map a block's zod props (+ optional per-prop control hints) to an ordered list of
 *  controls for the inspector. Hints override the zod-derived control but must be
 *  type-compatible; an unknown prop or an incompatible hint throws (never silently lossy,
 *  mirroring markdocAttributesFor). */
export function resolveControls(
  props: ZodTypeAny,
  hints: Record<string, BlockControl> = {},
): ResolvedControl[] {
  const attrs = markdocAttributesFor(props)
  for (const prop of Object.keys(hints)) {
    if (!(prop in attrs)) throw new Error(`resolveControls: hint for unknown prop "${prop}"`)
  }
  return Object.entries(attrs).map(([name, a]) => {
    // zod-derived default control
    const derived: BlockControl = a.matches ? 'select' : a.type === 'Number' ? 'number' : a.type === 'Boolean' ? 'switch' : 'text'
    const hint = hints[name]
    if (hint === undefined) {
      return { name, control: derived, ...(a.default !== undefined ? { default: a.default } : {}), ...(a.matches ? { options: a.matches } : {}) }
    }
    // a hint is only valid if compatible with the zod type
    const ENUM_HINTS: ReadonlySet<BlockControl> = new Set(['select', 'position9', 'align'])
    const ok =
      (a.matches && ENUM_HINTS.has(hint)) ||
      (a.type === 'Number' && hint === 'number') ||
      (a.type === 'Boolean' && hint === 'switch') ||
      (a.type === 'String' && !a.matches && STRING_CONTROLS.has(hint))
    if (!ok) throw new Error(`resolveControls: hint "${hint}" incompatible with prop "${name}" (zod ${a.type}${a.matches ? ' enum' : ''})`)
    return { name, control: hint, ...(a.default !== undefined ? { default: a.default } : {}), ...(a.matches ? { options: a.matches } : {}) }
  })
}
