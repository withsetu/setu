import { useEffect, useMemo, useState } from 'react'
import type { MediaIndexQuery, MediaIndexRow, MediaKind, MediaSortKey } from '@setu/core'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import type { UploadResult } from './upload-client'
import { MediaGrid } from './MediaGrid'
import { MediaDropzone } from './MediaDropzone'

export interface MediaFilters {
  q: string
  type: 'all' | MediaKind
  sort: { key: MediaSortKey; dir: 'asc' | 'desc' }
}

const TYPE_OPTIONS: { value: MediaFilters['type']; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'document', label: 'Documents' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'other', label: 'Other' },
]

const SORT_OPTIONS = [
  { label: 'Newest', key: 'uploadedAt', dir: 'desc' },
  { label: 'Name', key: 'filename', dir: 'asc' },
  { label: 'Largest', key: 'bytes', dir: 'desc' },
] as const

export const DEFAULT_SORT: MediaFilters['sort'] = { key: 'uploadedAt', dir: 'desc' }

export function sortValueOf(s: MediaFilters['sort']): string {
  return `${s.key}-${s.dir}`
}

export function parseSortValue(raw: string | null): MediaFilters['sort'] {
  if (raw) {
    const [key, dir] = raw.split('-')
    const o = SORT_OPTIONS.find((x) => x.key === key && x.dir === dir)
    if (o) return { key: o.key, dir: o.dir }
  }
  return DEFAULT_SORT
}

export interface MediaBrowserProps {
  apiBase: string
  mode: 'manage' | 'pick'
  filters: MediaFilters
  setFilters: (patch: Partial<MediaFilters>) => void
  onUploaded: (result: UploadResult) => void
  onError?: (msg: string) => void
  /** Pick mode: a tile was chosen → its `/media/...` src. */
  onPick?: (src: string) => void
  /** Manage mode: a tile was selected → opens its detail panel. */
  onSelect?: (row: MediaIndexRow) => void
  /** Bump to force the grid to re-query (after an upload/delete). */
  refreshKey?: number
}

/** The shared media browser: drag-drop upload on top, a search/sort/type toolbar,
 *  then the grid. Used by both the `/media` screen (manage mode) and the editor
 *  picker (pick mode) so the two never drift. Filter state is controlled by the
 *  caller (URL params for the screen, local state for the modal). */
export function MediaBrowser({ apiBase, mode, filters, setFilters, onUploaded, onError, onPick, onSelect, refreshKey = 0 }: MediaBrowserProps) {
  // Debounced search: local typing state → committed `q` filter.
  const [search, setSearch] = useState(filters.q)
  useEffect(() => { setSearch(filters.q) }, [filters.q])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== filters.q) setFilters({ q: search }) }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const query = useMemo<MediaIndexQuery>(
    () => ({ q: filters.q || undefined, type: filters.type, sort: filters.sort, offset: 0, limit: 100 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.q, filters.type, filters.sort.key, filters.sort.dir],
  )

  return (
    <div className="flex flex-col gap-3.5">
      <MediaDropzone
        apiBase={apiBase}
        accept={mode === 'pick' ? { 'image/*': [] } : undefined}
        onUploaded={onUploaded}
        onError={onError}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder="Search media" aria-label="Search media"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={sortValueOf(filters.sort)} onValueChange={(v) => setFilters({ sort: parseSortValue(v) })}>
          <SelectTrigger size="sm" aria-label="Sort" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => <SelectItem key={`${o.key}-${o.dir}`} value={`${o.key}-${o.dir}`}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.type} onValueChange={(v) => setFilters({ type: v as MediaFilters['type'] })}>
          <SelectTrigger size="sm" aria-label="Filter by type" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <MediaGrid
        key={refreshKey}
        mode={mode}
        apiBase={apiBase}
        query={query}
        onPick={onPick ? ({ src }) => onPick(src) : undefined}
        onSelect={onSelect}
      />
    </div>
  )
}
