import { configSchema } from './schema'
import type { ResolvedBlock, ResolvedConfig } from './types'

/** Validate an authored config, index its blocks, and derive the known-tag set.
 *  Throws a clear Error on invalid input (config errors must fail loudly). */
export function resolveConfig(raw: unknown): ResolvedConfig {
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n')
    throw new Error(`Invalid setu.config:\n${issues}`)
  }

  const blocks = parsed.data.blocks as ResolvedBlock[]
  const blocksByTag = new Map<string, ResolvedBlock>()
  for (const block of blocks) {
    if (blocksByTag.has(block.tag)) {
      throw new Error(`Duplicate block tag "${block.tag}" in setu.config.ts`)
    }
    blocksByTag.set(block.tag, block)
  }

  return {
    blocks,
    blocksByTag,
    knownBlockTags: new Set(blocksByTag.keys()),
    theme: parsed.data.theme,
    themeOptions: parsed.data.themeOptions,
  }
}
