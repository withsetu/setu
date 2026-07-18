import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export type TagRow = { tag: string; count: number }

/** Shared by the real list and its loading skeleton so the two can never drift —
 *  identical header = zero layout shift when data lands (#582). */
function TagListHead() {
  return (
    <div className="flex items-center border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[12.5px] text-muted-foreground">
      <div className="flex-1">Tag</div>
      <div className="w-28">Used by</div>
      <div className="w-10" />
    </div>
  )
}

/** Varied line widths so the placeholder reads as a list of tags, not stripes. */
const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-36']

/** Loading placeholder shaped like the tag list: same container, same header,
 *  same row paddings; the trailing skeleton matches the real delete button box
 *  (size-8), which governs row height — nothing shifts when data lands
 *  (#582, mirrors #572). */
export function TagListSkeleton() {
  return (
    <div className="rounded-lg border border-border/60">
      <TagListHead />
      {SKELETON_WIDTHS.map((w, i) => (
        <div
          key={i}
          className="flex items-center border-b border-border/40 px-4 py-3 last:border-0"
        >
          <div className="flex-1">
            <div className="flex h-8 items-center">
              <Skeleton className={`h-4 ${w}`} />
            </div>
          </div>
          <div className="w-28">
            <div className="flex h-8 items-center">
              <Skeleton className="h-3.5 w-16" />
            </div>
          </div>
          <div className="w-10">
            <Skeleton className="ml-auto size-8" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TagList({
  rows,
  onRename,
  onDelete
}: {
  rows: TagRow[]
  onRename: (from: string, to: string) => void
  onDelete: (row: TagRow) => void
}) {
  return (
    <div className="rounded-lg border border-border/60">
      <TagListHead />
      {rows.map((r) => (
        <div
          key={r.tag}
          className="flex items-center border-b border-border/40 px-4 py-3 last:border-0"
        >
          <div className="flex-1">
            <input
              key={`tag:${r.tag}`}
              defaultValue={r.tag}
              aria-label={`Rename ${r.tag}`}
              className="bg-transparent text-[15px] font-medium outline-none focus:underline"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== r.tag) onRename(r.tag, v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </div>
          <div className="w-28 text-[13px] text-muted-foreground">
            {r.count} {r.count === 1 ? 'entry' : 'entries'}
          </div>
          <div className="w-10 text-right">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${r.tag}`}
              onClick={() => onDelete(r)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
