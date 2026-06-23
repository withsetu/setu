import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useTaxonomy } from '../../data/taxonomy-store'
import { buildTree } from '@setu/core'
import { flatten } from './CategoryTree'

export function NewCategoryForm() {
  const { categories, create } = useTaxonomy()
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string>('')
  const rows = flatten(buildTree(categories))
  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await create({ name: trimmed, parent: parent || null })
    setName(''); setParent('')
  }
  return (
    <div className="mb-6 flex items-center gap-2">
      <Input className="max-w-xs" placeholder="New category name" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add() } }} />
      <Select value={parent || 'none'} onValueChange={(v) => setParent(v === 'none' ? '' : v)}>
        <SelectTrigger className="w-48"><SelectValue placeholder="No parent" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No parent</SelectItem>
          {rows.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button onClick={() => void add()}>Add category</Button>
    </div>
  )
}
