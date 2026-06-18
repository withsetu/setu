import { defineMarkdocConfig, component, nodes, Markdoc } from '@astrojs/markdoc/config'

// Detect GFM task markers ([ ]/[x]) on list items and render a checkbox. Mirrors the
// editor's TASK_RE; loose (multi-paragraph) items would inspect the first paragraph's
// text instead of a bare string — handled at build time, tight items proven here.
const TASK_RE = /^\[( |x|X)\](?: |$)/
function itemTransform(node, config) {
  const children = node.transformChildren(config)
  const first = children[0]
  if (typeof first === 'string') {
    const m = TASK_RE.exec(first)
    if (m) {
      const checked = m[1].toLowerCase() === 'x'
      const rest = [first.replace(TASK_RE, ''), ...children.slice(1)]
      const box = new Markdoc.Tag('input', { type: 'checkbox', checked, disabled: true })
      return new Markdoc.Tag('li', { class: 'task', 'data-checked': String(checked) }, [box, ' ', ...rest])
    }
  }
  return new Markdoc.Tag('li', node.transformAttributes(config), children)
}

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
    // Inline marks from the editor's {% sub %}/{% sup %} round-trip tags.
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
  },
  nodes: {
    // Node overrides so the editor's {% align %} annotation renders to text-align.
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
    // GFM task-list checkbox rendering.
    item: {
      ...nodes.item,
      transform: itemTransform,
    },
  },
})
