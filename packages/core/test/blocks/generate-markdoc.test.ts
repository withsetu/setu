import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildRegistry } from '../../src/blocks/registry'
import { defineBlock } from '../../src/blocks/define-block'
import { generateMarkdocTagsInclude } from '../../src/blocks/generate-markdoc'

describe('generateMarkdocTagsInclude', () => {
  it('emits a tags map with component() + derived attributes', () => {
    const reg = buildRegistry([
      {
        tag: 'callout',
        component: 'blocks/callout/callout.astro',
        contract: defineBlock({
          props: z.object({
            type: z.string().optional(),
            title: z.string().optional()
          })
        })
      }
    ])
    const out = generateMarkdocTagsInclude(reg)
    expect(out).toContain("import { component } from '@astrojs/markdoc/config'")
    expect(out).toContain('export const tags = {')
    expect(out).toContain('callout: {')
    expect(out).toContain(
      "render: component('../../blocks/callout/callout.astro'),"
    )
    // Each attribute goes through the site's named validator (#1126), not Markdoc's bare
    // `type: String`, whose messages never say which block failed.
    expect(out).toContain(
      `type: blockAttr('callout', 'type', { type: "String" })`
    )
    expect(out).toContain(
      `title: blockAttr('callout', 'title', { type: "String" })`
    )
    expect(out).toContain(`validate: blockTagValidate('callout')`)
  })

  it('prefixes a repo-root block path with ../../', () => {
    const reg = buildRegistry([
      {
        tag: 'callout',
        component: 'blocks/callout/callout.astro',
        contract: { props: z.object({}) }
      }
    ])
    const out = generateMarkdocTagsInclude(reg)
    expect(out).toContain(
      "render: component('../../blocks/callout/callout.astro')"
    )
  })

  it('emits a bare package-specifier renderer as-is', () => {
    const reg = buildRegistry([
      {
        tag: 'button',
        component: '@setu/blocks/button.astro',
        contract: { props: z.object({ href: z.string() }) }
      }
    ])
    const out = generateMarkdocTagsInclude(reg)
    expect(out).toContain("render: component('@setu/blocks/button.astro')")
  })
})
