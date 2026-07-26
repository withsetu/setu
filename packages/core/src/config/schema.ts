import { z, type ZodTypeAny } from 'zod'
import { permalinkPatternSchema } from '../permalinks/pattern'
import { isCanonicalPathSegment } from '../publish/content-path'
import { isZodObject, RESERVED_COLLECTION_NAMES } from './collections'

/** Duck-typed Zod-schema check (avoids dual-instance instanceof pitfalls). */
const isZodSchema = (val: unknown): val is ZodTypeAny =>
  typeof (val as { safeParse?: unknown })?.safeParse === 'function' &&
  typeof (val as { parse?: unknown })?.parse === 'function'

const blockEditorSchema = z
  .object({
    label: z.string().optional(),
    icon: z.string().optional(),
    group: z.string().optional(),
    variants: z.array(z.string()).optional()
  })
  .strict()

const blockSchema = z.object({
  tag: z.string().min(1, 'block.tag must be a non-empty string'),
  props: z.custom<ZodTypeAny>(isZodSchema, {
    message: 'block.props must be a Zod schema'
  }),
  component: z.string().min(1, 'block.component must be a non-empty string'),
  editor: blockEditorSchema.optional()
})

const collectionSchema = z.object({
  // isCanonicalPathSegment is the #670 guard the Git write path already applies; a
  // collection name reaches `contentPath` verbatim, so it is held to the same rule here
  // (see the it.each name cases in packages/core/test/config/collections.test.ts).
  name: z
    .string()
    .refine(isCanonicalPathSegment, {
      message: 'collection.name must be a canonical path segment'
    })
    .refine((n) => !RESERVED_COLLECTION_NAMES.has(n), {
      message: 'collection.name is reserved (it collides with a site route)'
    }),
  label: z.string().min(1).optional(),
  labelPlural: z.string().min(1).optional(),
  fields: z
    .custom<ZodTypeAny>(isZodObject, {
      message: 'collection.fields must be a Zod object schema'
    })
    .optional(),
  taxonomies: z.array(z.string()).optional()
})

export const configSchema = z.object({
  blocks: z.array(blockSchema).optional().default([]),
  collections: z.array(collectionSchema).optional().default([]),
  theme: z.string().optional(),
  themeOptions: z.record(z.string(), z.string()).optional(),
  permalinks: z.record(z.string(), permalinkPatternSchema).optional()
})
