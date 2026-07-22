// scripts/gen-blocks.mjs
// Build-time codegen: scan repo-root blocks/, build the registry, and write the site's
// Markdoc tags include. Run as apps/site's predev/prebuild. Pure build-time => zero
// per-visitor cost. Uses jiti (like @setu/core) to import the TS block contracts + core.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BLOCKS_DIR = path.join(ROOT, 'blocks')
const OUT = path.join(ROOT, 'apps', 'site', 'markdoc.blocks.generated.mjs')

// @setu/core, @setu/core/node and zod are NOT hoisted to the repo root (pnpm strict
// hoisting). Resolve them from packages/core where they ARE installed as dependencies.
// Anchors Node module resolution to the @setu/core package location; assumes the packages/core repo layout.
const coreReq = createRequire(
  path.join(ROOT, 'packages', 'core', 'package.json')
)

const jiti = createJiti(import.meta.url, {
  alias: {
    '@setu/core': coreReq.resolve('@setu/core'),
    '@setu/core/node': coreReq.resolve('@setu/core/node'),
    zod: coreReq.resolve('zod')
  }
})

/** A block folder name IS the block's tag, and it flows into generated JavaScript the site imports
 *  at build time (`component('blocks/<tag>/<tag>.astro')`). The consumer concatenates it into
 *  single-quoted JS string literals without escaping, so a quote or backslash breaks out of the
 *  literal and a `../` produces a specifier outside the blocks tree (#820). Same shape as the
 *  Markdoc tag grammar: lowercase, alphanumeric + dashes, must start with a letter.
 *  Enforced by the BAD_TAGS table in gen-blocks.test.mjs. */
const TAG_RE = /^[a-z][a-z0-9-]*$/

export function assertValidTag(tag) {
  if (!TAG_RE.test(tag))
    throw new Error(
      `gen-blocks: invalid block folder ${JSON.stringify(tag)} — a block tag must match ` +
        '/^[a-z][a-z0-9-]*$/ (lowercase letters, digits and dashes, starting with a letter). ' +
        'Rename the folder under blocks/.'
    )
  return tag
}

export async function loadEntries(blocksDir = BLOCKS_DIR) {
  if (!existsSync(blocksDir)) return []
  const entries = []
  for (const tag of readdirSync(blocksDir)) {
    const folder = path.join(blocksDir, tag)
    if (!statSync(folder).isDirectory()) continue
    const blockTs = path.join(folder, 'block.ts')
    if (!existsSync(blockTs)) continue // not a block folder — stray dirs are skipped, not rejected
    assertValidTag(tag)
    const astro = path.join(folder, `${tag}.astro`)
    if (!existsSync(astro))
      throw new Error(`block "${tag}": missing ${tag}.astro`)
    const contract = await jiti.import(blockTs, { default: true })
    entries.push({ tag, component: `blocks/${tag}/${tag}.astro`, contract })
  }
  return entries
}

export async function main() {
  const { buildRegistry, mergeBlockSources, STANDARD_BLOCKS } =
    await jiti.import('@setu/core')
  const { generateMarkdocTagsInclude } = await jiti.import('@setu/core/node')

  const local = await loadEntries()
  const entries = mergeBlockSources({ standard: STANDARD_BLOCKS, local })
  const registry = buildRegistry(entries)
  writeFileSync(OUT, generateMarkdocTagsInclude(registry))
  console.log(
    `gen-blocks: ${registry.blocks.length} block(s): ${registry.blocks.map((b) => b.tag).join(', ') || '(none)'}`
  )
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main()
