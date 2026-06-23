import { Button } from '@/components/ui/button'

export function Pager({ from, to, total, page, onPage }: {
  from: number; to: number; total: number; page: number; onPage: (p: number) => void
}) {
  return (
    <div className="flex items-center justify-between border-t border-border/40 px-5 py-3 text-sm text-muted-foreground">
      <span>{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</Button>
        <Button variant="outline" size="sm" disabled={to >= total} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  )
}
