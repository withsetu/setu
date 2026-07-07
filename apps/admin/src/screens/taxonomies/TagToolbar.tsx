import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'

export type TagSort = 'count' | 'alpha'

export function TagToolbar({
  q,
  onQ,
  sort,
  onSort
}: {
  q: string
  onQ: (v: string) => void
  sort: TagSort
  onSort: (s: TagSort) => void
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="relative max-w-xs flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search tags"
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
      <span className="text-sm text-muted-foreground">Sort</span>
      <Select value={sort} onValueChange={(v) => onSort(v as TagSort)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="count">Most used</SelectItem>
          <SelectItem value="alpha">A–Z</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
