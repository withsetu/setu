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
import {
  STATUS_FILTER_MENU,
  statusFilterLabel
} from '@/lib/status-filter-vocab'

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
  /** `published`, `draft` and `unpublished` are still valid `?status=` values
   *  (#579 deep links, the port contract) but are off-menu after the #598 UAT
   *  simplification. When one arrives from a URL, append it as its own entry
   *  rather than showing a menu where nothing is checked: the user sees exactly
   *  which filter is applied and can leave it via "All status". Selecting a
   *  listed option drops it — it only ever appears while it is the active value. */
  const offMenuStatus =
    status !== '' && !STATUS_FILTER_MENU.some((e) => e.value === status)
      ? status
      : null
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
          {/* Radix `Select.Value` renders its children instead of the selected
              item's text — the trigger stays a single short word while each menu
              option carries its explanatory hint line. */}
          <SelectValue placeholder="All status">
            {status ? statusFilterLabel(status) : 'All status'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All status</SelectItem>
          {/* Three choices, cut along intent rather than location — see
              status-filter-vocab.ts for why "Not on the site" can't label the
              Drafts set. The same list drives the dashboard's At-a-glance tiles,
              so a tile and the filter it opens always use the same words. */}
          {STATUS_FILTER_MENU.map((e) => (
            <SelectItem key={e.value} value={e.value}>
              <span className="flex flex-col items-start">
                <span>{e.label}</span>
                <span className="text-xs text-muted-foreground">{e.hint}</span>
              </span>
            </SelectItem>
          ))}
          {offMenuStatus !== null && (
            <>
              <SelectSeparator />
              <SelectItem value={offMenuStatus}>
                {statusFilterLabel(offMenuStatus)}
              </SelectItem>
            </>
          )}
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
