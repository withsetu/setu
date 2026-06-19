import { z, type ZodTypeAny } from 'zod'

/** Duck-typed Zod-schema check (avoids dual-instance instanceof pitfalls). */
const isZodSchema = (val: unknown): val is ZodTypeAny =>
  typeof (val as { safeParse?: unknown })?.safeParse === 'function' &&
  typeof (val as { parse?: unknown })?.parse === 'function'

const blockEditorSchema = z
  .object({
    label: z.string().optional(),
    icon: z.string().optional(),
    group: z.string().optional(),
    variants: z.array(z.string()).optional(),
  })
  .strict()

const blockSchema = z.object({
  tag: z.string().min(1, 'block.tag must be a non-empty string'),
  props: z.custom<ZodTypeAny>(isZodSchema, { message: 'block.props must be a Zod schema' }),
  component: z.string().min(1, 'block.component must be a non-empty string'),
  editor: blockEditorSchema.optional(),
})

export const configSchema = z.object({
  blocks: z.array(blockSchema).optional().default([]),
  theme: z.string().optional(),
  themeOptions: z.record(z.string(), z.string()).optional(),
})
