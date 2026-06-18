import { defineMarkdocConfig, component } from '@astrojs/markdoc/config'
// NOTE: import via relay (relative path) so esbuild bundles core instead of
// treating the workspace symlink as an external bare-specifier import.
// See src/core-relay.mjs for the full explanation.
import { resolveConfig, defaultConfig } from './src/core-relay.mjs'

// Render wrappers for custom blocks, keyed by tag. Codegen (#4) will generate these +
// derive attributes from each block's zod schema; for now they are authored by hand.
const BLOCK_WRAPPERS = {
  callout: {
    render: component('./src/components/CalloutWrapper.astro'),
    attributes: {
      type: { type: String, default: 'info' },
      title: { type: String },
    },
  },
}

// Source the custom-tag SET from saytu.config (not a hardcoded string). Fail loudly if a
// configured block has no wrapper yet — that's a real, surfaced gap, not a silent drop.
const customTags = {}
for (const block of resolveConfig(defaultConfig).blocks) {
  const wrapper = BLOCK_WRAPPERS[block.tag]
  if (!wrapper) throw new Error(`saytu-site: no render wrapper for config block "${block.tag}"`)
  customTags[block.tag] = wrapper
}

export default defineMarkdocConfig({
  tags: { ...customTags },
})
