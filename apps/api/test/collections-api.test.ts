import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveConfig } from '@setu/core'
import { createCollectionsApi } from '../src/collections-api'
import type { ResolvedActor } from '../src/auth/resolve-actor'

const config = resolveConfig({
  collections: [
    {
      name: 'product',
      labelPlural: 'Products',
      taxonomies: ['category'],
      fields: z.object({ sku: z.string() })
    }
  ]
})

const get = (actor: () => ResolvedActor | null) =>
  createCollectionsApi({
    resolveActor: actor,
    getConfig: () => config
  }).fetch(new Request('http://x/api/collections'))

const admin = (): ResolvedActor => ({ id: 'a', role: 'admin' })

describe('GET /api/collections', () => {
  it('returns every declared collection with its display metadata', async () => {
    const res = await get(admin)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      collections: {
        name: string
        label: string
        labelPlural: string
        taxonomies: string[]
      }[]
    }
    expect(body.collections.map((c) => c.name)).toEqual([
      'post',
      'page',
      'product'
    ])
    const product = body.collections.find((c) => c.name === 'product')
    expect(product).toEqual({
      fields: [{ name: 'sku', control: 'text', required: true }],
      name: 'product',
      label: 'Product',
      labelPlural: 'Products',
      taxonomies: ['category']
    })
  })

  // This began as "does not attempt to serialize the field schema", deferring the description to
  // #963 on the grounds that "shipping a half-serialized shape now would be a contract nobody can
  // rely on". #1125 is that deferral coming due, and the guard it wanted still holds: what crosses
  // the wire is `resolveControls`' output — a complete contract the block inspector already
  // renders — never zod itself. The precompiled `schema` and any raw `_def` must still never
  // appear, because that WOULD be the unusable half-serialized shape.
  it('never puts raw zod on the wire', async () => {
    const res = await get(admin)
    const body = (await res.json()) as {
      collections: Record<string, unknown>[]
    }
    for (const c of body.collections) {
      expect(c['schema']).toBeUndefined()
      expect(JSON.stringify(c)).not.toContain('_def')
      expect(JSON.stringify(c)).not.toContain('typeName')
    }
  })

  it('401s an unauthenticated caller', async () => {
    const res = await get(() => null)
    expect(res.status).toBe(401)
  })

  // content.view is held by all four roles, so there is no wrong-actor case to assert here —
  // the gate that matters is the unauthenticated one above. The action is still declared
  // explicitly so the route moves with the matrix if content.view is ever narrowed.
  it.each(['admin', 'maintainer', 'editor', 'author'] as const)(
    'admits a %s',
    async (role) => {
      const res = await get(() => ({ id: 'u', role }))
      expect(res.status).toBe(200)
    }
  )
})

/**
 * #1125: the admin cannot render an entry form for a declared collection unless it is told what
 * the fields ARE. The write path already enforces the schema — the #962 spike measured an editor
 * creating a product and getting a 422 naming seven required fields, none of which the admin had a
 * control for — so this endpoint was the missing half, not the validation.
 *
 * The projection is `resolveControls`, the same function the block inspector already renders from
 * (apps/admin/src/editor/BlockInspector.tsx). It is plain JSON by construction, so no zod internals
 * cross the wire and the admin gains no coupling to zod's `_def` layout.
 */
describe('GET /api/collections — declared field schema (#1125)', () => {
  it('projects a declared schema into renderable controls', async () => {
    const res = await get(admin)
    const body = (await res.json()) as {
      collections: { name: string; fields?: unknown[] }[]
    }
    const product = body.collections.find((c) => c.name === 'product')!
    expect(product.fields).toEqual([
      { name: 'sku', control: 'text', required: true }
    ])
  })

  it('omits `fields` entirely for a collection that declares none', async () => {
    const res = await get(admin)
    const body = (await res.json()) as {
      collections: { name: string; fields?: unknown[] }[]
    }
    // Absent, not `[]`: "this collection has no custom fields" and "this collection's fields could
    // not be read" must stay distinguishable in the admin (§4 #22).
    expect(body.collections.find((c) => c.name === 'page')).not.toHaveProperty(
      'fields'
    )
  })

  it('a schema resolveControls cannot render degrades LOUDLY, and does not take the endpoint down', async () => {
    // An array field with no control hint is the documented throw in resolveControls — and a
    // collection is free to declare one, since nothing stops it. Before #1125 this would have been
    // a 500 on the whole endpoint, so every OTHER collection disappeared from the admin too.
    const hostile = resolveConfig({
      collections: [
        { name: 'gear', fields: z.object({ specs: z.array(z.string()) }) },
        { name: 'note', fields: z.object({ body: z.string() }) }
      ]
    })
    const res = await createCollectionsApi({
      resolveActor: admin,
      getConfig: () => hostile
    }).fetch(new Request('http://x/api/collections'))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      collections: { name: string; fields?: unknown[]; fieldsError?: string }[]
    }
    const gear = body.collections.find((c) => c.name === 'gear')!
    expect(gear.fields).toBeUndefined()
    expect(gear.fieldsError).toMatch(/specs/)

    // The healthy sibling is unaffected — the failure is scoped to the collection that caused it.
    const note = body.collections.find((c) => c.name === 'note')!
    expect(note.fields).toEqual([
      { name: 'body', control: 'text', required: true }
    ])
    expect(note.fieldsError).toBeUndefined()
  })
})
