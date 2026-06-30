import { defineMarkdocConfig, component, nodes, Markdoc } from '@astrojs/markdoc/config'
import { tags as generatedTags } from './markdoc.blocks.generated.mjs'

// Block tags (e.g. callout) are AUTO-GENERATED from blocks/<tag>/ folders by
// scripts/gen-blocks.mjs into ./markdoc.blocks.generated.mjs and spread in below.
// `sub` and `sup` remain hand-authored inline tags — they are inline Markdoc
// tags, not folder blocks, and are listed explicitly beneath.

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
    ...generatedTags,
    sub: { render: component('./src/components/Sub.astro') },
    sup: { render: component('./src/components/Sup.astro') },
    image: {
      render: component('@setu/image-astro/ImageFigure.astro'),
      attributes: {
        src: { type: String },
        alt: { type: String },
        caption: { type: String },
        align: { type: String, matches: ['none', 'left', 'right', 'wide', 'full'], default: 'none' },
      },
    },
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
    image: {
      ...nodes.image,
      render: component('@setu/image-astro/Image.astro'),
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
