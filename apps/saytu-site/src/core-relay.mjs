// Relay: provides resolveConfig + defaultConfig for markdoc.config.mjs.
//
// WHY THIS EXISTS:
// @astrojs/markdoc's load-config.js uses esbuild with packages:'external', which
// leaves bare-specifier imports (like `@saytu/core`) unresolved in the bundled
// output — they remain as runtime imports. The workspace symlink in node_modules
// resolves to packages/core/src/index.ts, but Node v22 native ESM can't load
// extensionless .ts internal imports from there.
//
// Using relative paths forces esbuild to bundle the code inline, but packages/core
// imports `zod` (another bare specifier), which also gets marked external — and zod
// isn't a dependency of apps/saytu-site, so it can't be resolved at runtime either.
//
// SOLUTION: export a lean version of resolveConfig + defaultConfig that contains
// only what markdoc.config.mjs actually needs (the `tag` field of each block).
// This avoids pulling in zod entirely. The tag-set contract is preserved: if you
// add blocks to the default config, add them here too (codegen step #4 will
// generate this file automatically, making the manual sync unnecessary).

/** Minimal re-implementation of resolveConfig — only indexes blocks by tag.
 *  No zod validation at config-bundle time (that validation runs in the full runtime). */
export function resolveConfig(config) {
  const blocks = config.blocks
  const blocksByTag = new Map()
  for (const block of blocks) {
    if (blocksByTag.has(block.tag))
      throw new Error(`Duplicate block tag "${block.tag}" in saytu.config`)
    blocksByTag.set(block.tag, block)
  }
  return { blocks, blocksByTag, knownBlockTags: new Set(blocksByTag.keys()) }
}

/** Minimal mirror of defaultConfig — just the tag fields needed by markdoc.config.mjs.
 *  The full @saytu/core defaultConfig includes zod prop-schemas; those are only needed
 *  by the editor, not the static renderer. */
export const defaultConfig = {
  blocks: [
    { tag: 'callout' },
  ],
}
