import { Badge } from '@/components/ui/badge'

export function Chips({
  items,
  name
}: {
  items: string[]
  name?: (s: string) => string
}) {
  if (items.length === 0)
    return <span className="text-muted-foreground">—</span>
  const shown = items.slice(0, 2)
  const extra = items.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((it) => (
        <Badge key={it} variant="outline" className="font-normal">
          {name ? name(it) : it}
        </Badge>
      ))}
      {extra > 0 && (
        <span className="text-xs text-muted-foreground">+{extra}</span>
      )}
    </span>
  )
}
