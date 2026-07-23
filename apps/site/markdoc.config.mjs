import {
  defineMarkdocConfig,
  component,
  nodes,
  Markdoc
} from '@astrojs/markdoc/config'
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
  if (
    first instanceof Markdoc.Tag &&
    first.name === 'paragraph' &&
    Array.isArray(first.children)
  ) {
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
      const box = new Markdoc.Tag('input', {
        type: 'checkbox',
        checked,
        disabled: true
      })
      const body = isParagraph
        ? [box, ' ', new Markdoc.Tag('span', {}, rest), ...children.slice(1)]
        : [box, ' ', ...rest]
      return new Markdoc.Tag(
        'li',
        { class: 'task', 'data-checked': String(checked) },
        body
      )
    }
  }
  return new Markdoc.Tag('li', node.transformAttributes(config), children)
}

// #769 — the RENDER side of the multi-block table-cell fold (#752).
//
// A GFM cell is inline-only, so the serializer folds a cell's block children onto one
// line joined by a literal `<br>`, and the reader (`splitCellBreaks` in @setu/core)
// heals that back into a hardBreak. Two of the three parties agreed; the renderer did
// not. Markdoc parses a cell as inline content with raw HTML off, so `one<br>two`
// arrived as a plain text node and Astro escaped it — the published page showed the
// literal characters `one<br>two`. This is the reader's rule, mirrored on the way out.
//
// Deliberately NOT `set:html`: cell text is author-controlled but the page is public
// output, so nothing here is ever handed to an HTML parser. The string is SPLIT into
// text fragments interleaved with real `br` Tags, and every fragment stays a plain
// string that the renderer escapes as usual — an author who types `<script>` in a cell
// still gets `&lt;script&gt;`. Only the exact `<br>` spellings below become elements.
const CELL_BR = /<br\s*\/?>/gi

/** Split every string in a transformed cell's children on `<br>`, interleaving real
 *  `br` tags. Recurses into tag children so a break inside a mark (`**a<br>b**`)
 *  splits with the formatting intact — the same shape `splitCellBreaks` produces,
 *  which preserves each fragment's marks.
 *
 *  #785 — a CODE span is exempt, on both sides. This comment used to claim Markdoc's
 *  `code` tag "carries its payload in ATTRIBUTES with no children, so a `<br>` inside a
 *  code span is left literal, exactly as it reads back in the editor". Neither half was
 *  true. The transform emits `Tag('code', {}, ['a<br>b'])` — the payload is a CHILD
 *  string — so the recursion split it here and the page rendered a real break inside
 *  `<code>`; and the reader (`splitCellBreaks` in @setu/core to-tiptap) split it too,
 *  because a code span arrives there as a TEXT node carrying a `code` mark, which its
 *  `type !== 'text'` guard did not cover. Code-span content is literal by definition —
 *  the writer will not even escape it (see escape-inline) — and a cell fold never puts
 *  a `<br>` inside a span in the first place: the fold joins a cell's BLOCK children.
 *  Both sides now leave it alone, so the editor, the file and the page agree. */
function splitCellBreaks(children) {
  const out = []
  for (const child of children) {
    if (typeof child === 'string') {
      const parts = child.split(CELL_BR)
      parts.forEach((part, i) => {
        if (i > 0) out.push(new Markdoc.Tag('br'))
        if (part !== '') out.push(part)
      })
    } else if (child instanceof Markdoc.Tag && child.name === 'code') {
      out.push(child)
    } else if (child instanceof Markdoc.Tag && Array.isArray(child.children)) {
      out.push(
        new Markdoc.Tag(
          child.name,
          child.attributes,
          splitCellBreaks(child.children)
        )
      )
    } else {
      out.push(child)
    }
  }
  return out
}

/** The default node transform (see @astrojs/markdoc's own `heading` node for the shape),
 *  with the cell's `<br>` fragments turned into real breaks. */
function cellTag(render, node, config) {
  return new Markdoc.Tag(
    render,
    node.transformAttributes(config),
    splitCellBreaks(node.transformChildren(config))
  )
}

// These two MUST each spell `config.nodes?.<key>?.render` literally, and cannot be one
// shared `config.nodes?.[node.type]?.render` helper. @astrojs/markdoc resolves a
// `render: component(...)` descriptor by REWRITING `config.nodes[key].render` at runtime
// (resolveComponentImports), and it silently `delete`s any custom `transform` that its
// `transformRespectsRender` source-text check — a literal `.toString().includes()` on the
// function body — cannot prove reads that field back. A shared helper typechecks, builds
// and runs with no warning; the transform is simply dropped and the cell renders the old,
// broken way. Found the hard way: the first cut of this fix was never called.
function tdTransform(node, config) {
  return cellTag(config.nodes?.td?.render ?? 'td', node, config)
}
function thTransform(node, config) {
  return cellTag(config.nodes?.th?.render ?? 'th', node, config)
}

// #857: constrain the author-controlled `align` on paragraph/heading/th/td to a fixed set
// — the same defence the `image` tag already gets via `matches`. The editor only ever
// emits left/center/right (Canvas.tsx TextAlign + TableMenu setColumnAlign); `justify` is
// included as a legitimate hand-authored typographic value. Content can be POSTed directly,
// so this declaration pairs with the render-sink clamp in each component (safeTextAlign in
// packages/blocks, mirrored inline) — an unlisted value like `right;position:fixed` is
// dropped, never interpolated into `text-align:${align}`.
const ALIGN_ATTR = {
  type: String,
  matches: ['left', 'center', 'right', 'justify']
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
        align: {
          type: String,
          matches: ['none', 'left', 'right', 'wide', 'full'],
          default: 'none'
        }
      }
    }
  },
  nodes: {
    paragraph: {
      ...nodes.paragraph,
      render: component('./src/components/Paragraph.astro'),
      attributes: { ...nodes.paragraph.attributes, align: ALIGN_ATTR }
    },
    heading: {
      ...nodes.heading,
      render: component('./src/components/Heading.astro'),
      attributes: { ...nodes.heading.attributes, align: ALIGN_ATTR }
    },
    item: {
      ...nodes.item,
      transform: itemTransform
    },
    image: {
      ...nodes.image,
      render: component('@setu/image-astro/Image.astro')
    },
    th: {
      ...nodes.th,
      render: component('./src/components/Th.astro'),
      attributes: { ...nodes.th.attributes, align: ALIGN_ATTR },
      transform: thTransform
    },
    td: {
      ...nodes.td,
      render: component('./src/components/Td.astro'),
      attributes: { ...nodes.td.attributes, align: ALIGN_ATTR },
      transform: tdTransform
    }
  }
})
