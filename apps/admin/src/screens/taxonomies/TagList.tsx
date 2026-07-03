import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type TagRow = { tag: string; count: number }

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
      <div className="flex items-center border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[12.5px] text-muted-foreground">
        <div className="flex-1">Tag</div>
        <div className="w-28">Used by</div>
        <div className="w-10" />
      </div>
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
