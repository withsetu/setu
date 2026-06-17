import { defineMarkdocConfig, component } from '@astrojs/markdoc/config'

// THE render plane of the "write once" model: a Markdoc tag maps to a thin .astro
// WRAPPER that renders a single React visual core. The author writes only the React
// component (Callout.tsx); this tag->wrapper wiring is what codegen would generate
// from the component contract.
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
