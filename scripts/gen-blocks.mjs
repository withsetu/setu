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

async function loadEntries() {
  if (!existsSync(BLOCKS_DIR)) return []
  const entries = []
  for (const tag of readdirSync(BLOCKS_DIR)) {
    const folder = path.join(BLOCKS_DIR, tag)
    if (!statSync(folder).isDirectory()) continue
    const blockTs = path.join(folder, 'block.ts')
    if (!existsSync(blockTs)) continue
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
