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
      {shown.map((it) => {
        const label = name ? name(it) : it
        return (
          // max-w + truncate: a long label (e.g. the category "Arts of Greece, Rome,
          // and Byzantium") must not balloon its column and squeeze the Title column
          // (#576/#577 review) — it truncates, full text on hover.
          <Badge
            key={it}
            variant="outline"
            title={label}
            className="max-w-32 font-normal"
          >
            <span className="truncate">{label}</span>
          </Badge>
        )
      })}
      {extra > 0 && (
        <span className="text-xs text-muted-foreground">+{extra}</span>
      )}
    </span>
  )
}
