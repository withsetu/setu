import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// The draft-preview route (src/preview/preview.astro) hand-maps each block tag to its component.
// If a block is missing from that map, drafts containing it render NOTHING — the published build
// works while the preview silently drops the block (the exact bug hit by the query block). This
// guard fails the moment the map drifts from the set of real blocks.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(appDir, '..', '..')

// Every folder block under blocks/, plus the standard blocks that ship a renderer from
// @setu/blocks (button, hero — keep in sync if a new rendered standard block is added).
const folderBlocks = readdirSync(join(repoRoot, 'blocks'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
const standardRenderedBlocks = ['button', 'hero']
const requiredTags = [...new Set([...folderBlocks, ...standardRenderedBlocks])]

const previewSrc = readFileSync(join(appDir, 'src', 'preview', 'preview.astro'), 'utf8')
const mapBody = previewSrc.match(/tagComponentMap\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

describe('draft preview renders every block', () => {
  it('maps each block tag so drafts preview identically to the published build', () => {
    expect(mapBody, 'tagComponentMap literal not found in preview.astro').not.toBe('')
    const missing = requiredTags.filter((tag) => !new RegExp(`(^|[^\\w])${tag}\\s*:`).test(mapBody))
    expect(missing, `blocks missing from the draft-preview component map: ${missing.join(', ')}`).toEqual([])
  })
})
