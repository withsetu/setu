import { defineMarkdocConfig, component, nodes, Markdoc } from '@astrojs/markdoc/config'

// Custom block tags -> render wrappers. In sub-project #1 this map is authored BY HAND.
//
// We would prefer to SOURCE the tag set from saytu.config (@setu/core's defaultConfig),
// but @astrojs/markdoc loads this config file through esbuild (packages:'external') + native
// ESM, which cannot load @setu/core's TypeScript source (extensionless .ts imports + zod).
// Verified: a direct `import ... from '@setu/core'` here fails at build with
// "Cannot find module .../packages/core/src/markdoc/to-tiptap".
//
// Deriving this map from saytu.config belongs to sub-project #4 (codegen), which runs in a
// build step that CAN read core and will generate this file. Until then, keep this in sync
// with saytu.config's blocks by hand (today: the single `callout` block).

// Detect GFM task markers and render a read-only checkbox. Mirrors the editor's TASK_RE.
// Tight items expose the marker as a bare string child; loose (multi-paragraph) items
// wrap it in a paragraph Tag whose first child is then inspected.
const TASK_RE = /^\[( |x|X)\](?: |$)/
function itemTransform(node, config) {
  const children = node.transformChildren(config)
  let first = children[0]
  let target = children
  let isParagraph = false
  if (first instanceof Markdoc.Tag && first.name === 'paragraph' && Array.isArray(first.children)) {
    target = first.children
    first = target[0]
    isParagraph = true
  }
  if (typeof first === 'string') {
    const m = TASK_RE.exec(first)
    if (m) {
      const checked = m[1].toLowerCase() === 'x'
      const stripped = first.replace(TASK_RE, '')
      const rest = [stripped, ...target.slice(1)]
      const box = new Markdoc.Tag('input', { type: 'checkbox', checked, disabled: true })
      const body = isParagraph
        ? [box, ' ', new Markdoc.Tag('span', {}, rest), ...children.slice(1)]
        : [box, ' ', ...rest]
      return new Markdoc.Tag('li', { class: 'task', 'data-checked': String(checked) }, body)
    }
  }
  return new Markdoc.Tag('li', node.transformAttributes(config), children)
}

export default defineMarkdocConfig({
  tags: {
    callout: {
      render: component('./src/components/CalloutWrapper.astro'),
      attributes: {
        type: { type: String, default: 'info' },
        title: { type: String },
      },
    },
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
  },
  nodes: {
    paragraph: {
      ...nodes.paragraph,
      render: component('./src/components/Paragraph.astro'),
      attributes: { ...nodes.paragraph.attributes, align: { type: String } },
    },
    heading: {
      ...nodes.heading,
      render: component('./src/components/Heading.astro'),
      attributes: { ...nodes.heading.attributes, align: { type: String } },
    },
    item: {
      ...nodes.item,
      transform: itemTransform,
    },
    th: {
      ...nodes.th,
      render: component('./src/components/Th.astro'),
      attributes: { ...nodes.th.attributes, align: { type: String } },
    },
    td: {
      ...nodes.td,
      render: component('./src/components/Td.astro'),
      attributes: { ...nodes.td.attributes, align: { type: String } },
    },
  },
})
