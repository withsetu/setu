import { defineMarkdocConfig, component } from '@astrojs/markdoc/config'

// This IS the Theme API render side: saytu.config maps a Markdoc tag -> a real
// component. Here the {% callout %} tag renders through Callout.astro.
export default defineMarkdocConfig({
  tags: {
    callout: {
      render: component('./src/components/Callout.astro'),
      attributes: {
        type: { type: String, default: 'info' },
      },
    },
  },
})
