import { defineMarkdocConfig, component } from '@astrojs/markdoc/config'

// Custom block tags -> render wrappers. In sub-project #1 this map is authored BY HAND.
//
// We would prefer to SOURCE the tag set from saytu.config (@saytu/core's defaultConfig),
// but @astrojs/markdoc loads this config file through esbuild (packages:'external') + native
// ESM, which cannot load @saytu/core's TypeScript source (extensionless .ts imports + zod).
// Verified: a direct `import ... from '@saytu/core'` here fails at build with
// "Cannot find module .../packages/core/src/markdoc/to-tiptap".
//
// Deriving this map from saytu.config belongs to sub-project #4 (codegen), which runs in a
// build step that CAN read core and will generate this file. Until then, keep this in sync
// with saytu.config's blocks by hand (today: the single `callout` block).
export default defineMarkdocConfig({
  tags: {
    callout: {
      render: component('./src/components/CalloutWrapper.astro'),
      attributes: {
        type: { type: String, default: 'info' },
        title: { type: String },
      },
    },
  },
})
