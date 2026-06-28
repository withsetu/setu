import type { ControlProps } from './types'

const CELLS = [
  'top-left','top-center','top-right',
  'middle-left','center','middle-right',
  'bottom-left','bottom-center','bottom-right',
] as const

export function Position9({ value, onChange, meta }: ControlProps) {
  const current = String(value ?? 'center')
  return (
    <div role="radiogroup" aria-label={meta.name}
      className="grid w-[84px] grid-cols-3 gap-1 rounded-md border border-border bg-muted/40 p-1">
      {CELLS.map((c) => {
        const active = c === current
        return (
          <button key={c} type="button" role="radio" aria-checked={active} aria-label={c}
            onClick={() => onChange(c)}
            className={`size-6 rounded-sm transition-colors ${active ? 'bg-foreground' : 'bg-foreground/15 hover:bg-foreground/30'}`} />
        )
      })}
    </div>
  )
}
