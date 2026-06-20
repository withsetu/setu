import { describe, expect, it } from 'vitest'
import { buildTree } from './tree'
import type { Category } from './types'

const cat = (slug: string, parent: string | null = null): Category => ({ slug, name: slug, parent })

describe('buildTree', () => {
  it('nests children under parents with depth', () => {
    const tree = buildTree([cat('a'), cat('b', 'a'), cat('c', 'b')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.slug).toBe('a')
    expect(tree[0]!.depth).toBe(0)
    expect(tree[0]!.children[0]!.slug).toBe('b')
    expect(tree[0]!.children[0]!.depth).toBe(1)
    expect(tree[0]!.children[0]!.children[0]!.slug).toBe('c')
    expect(tree[0]!.children[0]!.children[0]!.depth).toBe(2)
  })

  it('treats an orphan (missing parent) as a root', () => {
    const tree = buildTree([cat('x', 'ghost')])
    expect(tree.map((n) => n.slug)).toEqual(['x'])
    expect(tree[0]!.depth).toBe(0)
  })

  it('does not loop on a cycle; cycle members surface as roots', () => {
    const tree = buildTree([cat('a', 'b'), cat('b', 'a')])
    expect(tree.map((n) => n.slug).sort()).toEqual(['a', 'b'])
  })

  it('preserves input order of roots', () => {
    expect(buildTree([cat('z'), cat('m'), cat('a')]).map((n) => n.slug)).toEqual(['z', 'm', 'a'])
  })
})
