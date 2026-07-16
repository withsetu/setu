import type { ZodTypeAny } from 'zod'

export interface MarkdocAttr {
  type: 'String' | 'Number' | 'Boolean' | 'Array'
  default?: unknown
  matches?: string[]
}

const BASE: Record<string, MarkdocAttr['type']> = {
  ZodString: 'String',
  ZodNumber: 'Number',
  ZodBoolean: 'Boolean',
  // Markdoc supports Array-typed tag attributes natively ({% tag items=[…] %});
  // element validation stays with the block's zod contract at the content boundary.
  ZodArray: 'Array'
}

/** Peel ZodOptional/ZodDefault, capturing a default value if one is present. */
function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; default?: unknown } {
  let s = schema as {
    _def?: {
      typeName?: string
      innerType?: ZodTypeAny
      defaultValue?: () => unknown
    }
  }
  let def: unknown
  while (
    s?._def?.typeName === 'ZodOptional' ||
    s?._def?.typeName === 'ZodDefault'
  ) {
    if (s._def.typeName === 'ZodDefault' && s._def.defaultValue)
      def = s._def.defaultValue()
    s = s._def.innerType as typeof s
  }
  return { inner: s as ZodTypeAny, default: def }
}

/** Map a block's zod `props` object to Markdoc attribute descriptors — the same zod
 *  authored for validation, reused as the DRY single source. Throws on an unsupported
 *  type so a registration is never silently lossy. */
export function markdocAttributesFor(
  props: ZodTypeAny
): Record<string, MarkdocAttr> {
  const def = (
    props as {
      _def?: { typeName?: string; shape?: () => Record<string, ZodTypeAny> }
    }
  )._def
  if (def?.typeName !== 'ZodObject' || !def.shape) {
    throw new Error('markdocAttributesFor: props must be a z.object schema')
  }
  const shape = def.shape()
  const out: Record<string, MarkdocAttr> = {}
  for (const [name, field] of Object.entries(shape)) {
    const { inner, default: dflt } = unwrap(field)
    const tn =
      (inner as { _def?: { typeName?: string; values?: string[] } })._def
        ?.typeName ?? ''
    let attr: MarkdocAttr
    if (tn === 'ZodEnum') {
      attr = {
        type: 'String',
        matches: [...(inner as { _def: { values: string[] } })._def.values]
      }
    } else if (BASE[tn]) {
      attr = { type: BASE[tn] }
    } else {
      throw new Error(
        `markdocAttributesFor: attr "${name}" has unsupported zod type "${tn}"`
      )
    }
    if (dflt !== undefined) attr.default = dflt
    out[name] = attr
  }
  return out
}
