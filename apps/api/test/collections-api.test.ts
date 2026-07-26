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
      name: 'product',
      label: 'Product',
      labelPlural: 'Products',
      taxonomies: ['category']
    })
  })

  // The zod schema is not serializable and describing fields for the admin form is #963's
  // job. Shipping a half-serialized shape now would be a contract nobody can rely on.
  it('does not attempt to serialize the field schema', async () => {
    const res = await get(admin)
    const body = (await res.json()) as {
      collections: Record<string, unknown>[]
    }
    for (const c of body.collections) {
      expect(c['fields']).toBeUndefined()
      expect(c['schema']).toBeUndefined()
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
