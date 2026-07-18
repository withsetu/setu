import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectSeparator
} from '@/components/ui/select'
import { TagFilter } from '../TagFilter'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  staged: 'Staged',
  live: 'Live',
  unpublished: 'Unpublished'
}
const STATUSES = ['draft', 'staged', 'live', 'unpublished']

/** Compact trigger text. The `published` OPTION spells out "(staged + live)" so
 *  the union is never guessed at, but that string would clamp in the 9rem trigger
 *  — Radix `Select.Value` renders its children instead of the selected item's
 *  text, so the trigger shows the short form while the menu stays explicit. */
const STATUS_TRIGGER_LABELS: Record<string, string> = {
  ...STATUS_LABELS,
  published: 'Published',
  'not-published': 'Not published'
}

export function ListToolbar({
  title,
  search,
  onSearch,
  status,
  onStatus,
  category,
  onCategory,
  catRows,
  tag,
  onTag,
  featured,
  onFeatured,
  seo,
  onSeo,
  hasFilters,
  onClear,
  columnsMenu
}: {
  title: string
  search: string
  onSearch: (v: string) => void
  status: string
  onStatus: (v: string) => void
  category: string
  onCategory: (v: string) => void
  catRows: { slug: string; name: string; depth: number }[]
  tag: string
  onTag: (v: string) => void
  /** '' (all) | 'has' | 'none' — mirrors the `featured` URL param (#576). */
  featured: string
  onFeatured: (v: string) => void
  /** '' (all) | 'custom' | 'none' — mirrors the `seo` URL param (#577). */
  seo: string
  onSeo: (v: string) => void
  hasFilters: boolean
  onClear: () => void
  columnsMenu: ReactNode
}) {
  // shadcn Select uses a sentinel for "all" (empty string is not a valid SelectItem value).
  const ALL = '__all__'
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={`Search ${title.toLowerCase()}`}
          aria-label="Search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <Select
        value={status || ALL}
        onValueChange={(v) => onStatus(v === ALL ? '' : v)}
      >
        <SelectTrigger size="sm" aria-label="Filter by status" className="w-36">
          <SelectValue placeholder="All status">
            {status ? (STATUS_TRIGGER_LABELS[status] ?? status) : 'All status'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All status</SelectItem>
          {/* 'published' is the staged+live union (#579) — it sits above the
              separator with the other "spans several states" option because it
              answers a different question than the exact lifecycle states below.
              Setu is deliberate that staged ≠ live (saved ≠ live), so the union
              is offered, never assumed. */}
          <SelectItem value="published">Published (staged + live)</SelectItem>
          {/* #611: the exact complement of 'published'. The Drafts tile counts
              draft + unpublished — both mean "not on the site", they differ only
              in whether the entry was ever deployed — so the list has to be able
              to show that same set, or the tile lies about where it takes you. */}
          <SelectItem value="not-published">
            Not published (draft + unpublished)
          </SelectItem>
          <SelectSeparator />
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={category || ALL}
        onValueChange={(v) => onCategory(v === ALL ? '' : v)}
      >
        <SelectTrigger
          size="sm"
          aria-label="Filter by category"
          className="w-40"
        >
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All categories</SelectItem>
          {catRows.map((c) => (
            <SelectItem key={c.slug} value={c.slug}>
              <span style={{ paddingLeft: c.depth * 12 }}>{c.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TagFilter value={tag} onChange={onTag} />
      <Select
        value={featured || ALL}
        onValueChange={(v) => onFeatured(v === ALL ? '' : v)}
      >
        <SelectTrigger
          size="sm"
          aria-label="Filter by featured image"
          className="w-44"
        >
          <SelectValue placeholder="Featured: all" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Featured: all</SelectItem>
          <SelectItem value="has">Has featured image</SelectItem>
          <SelectItem value="none">No featured image</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={seo || ALL}
        onValueChange={(v) => onSeo(v === ALL ? '' : v)}
      >
        <SelectTrigger size="sm" aria-label="Filter by SEO" className="w-36">
          <SelectValue placeholder="SEO: all" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>SEO: all</SelectItem>
          <SelectItem value="custom">Custom SEO</SelectItem>
          <SelectItem value="none">No custom SEO</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      )}
      <div className="ml-auto">{columnsMenu}</div>
    </div>
  )
}
