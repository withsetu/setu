import { Tag } from 'lucide-react'

export function TagsTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 py-16 text-center">
      <Tag className="mb-3 size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Tag management is coming soon</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        You can already add tags while editing content. Bulk rename, merge, and cleanup will live here.
      </p>
    </div>
  )
}
