import { z, type ZodTypeAny } from 'zod'

/** `_def` marker for a block prop that names a declared collection. `Symbol.for` (not a
 *  module-local symbol) because block contracts are loaded through jiti and Vite, which can
 *  hand core two module instances — the same dual-instance hazard `isZodObject` documents. An
 *  enumerable symbol key on `_def` survives zod's clone-on-chain (`{ ...this._def }`), so
 *  `collectionRef().max(40)` keeps it (packages/core/test/blocks/collection-ref.test.ts). */
const COLLECTION_REF = Symbol.for('setu.block-prop.collection-ref')

/** A block prop whose value is the name of a collection declared in `setu.config`
 *  (`post`, `page`, or any the site adds — #1126). At the zod layer it is a non-empty string:
 *  the declared set is only known once the config resolves, so membership is checked where
 *  the config IS known — the site's Markdoc validation (`generateMarkdocTagsInclude`'s
 *  `collections`) — and the editor renders it as a picker fed by `/api/collections`. */
export function collectionRef(): z.ZodString {
  const s = z.string().min(1)
  ;(s._def as unknown as Record<symbol, unknown>)[COLLECTION_REF] = true
  return s
}

export function isCollectionRef(schema: ZodTypeAny | undefined): boolean {
  const def = (schema as { _def?: Record<symbol, unknown> } | undefined)?._def
  return def?.[COLLECTION_REF] === true
}
