import { useRef, type KeyboardEvent } from 'react'
import { toDisplayString, type ControlProps } from './types'

const CELLS = [
  'top-left','top-center','top-right',
  'middle-left','center','middle-right',
  'bottom-left','bottom-center','bottom-right',
] as const

/** 3×3 position grid. A radiogroup with roving tabindex: one tab stop, arrow
 *  keys move between cells (←/→ by one, ↑/↓ by a row), Home/End jump to ends. */
export function Position9({ value, onChange, meta }: ControlProps) {
  const current = toDisplayString(value, 'center')
  const idx = Math.max(0, CELLS.indexOf(current as (typeof CELLS)[number]))
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (next: number) => {
    const n = (next + CELLS.length) % CELLS.length
    onChange(CELLS[n])
    refs.current[n]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    let next: number | null = null
    if (e.key === 'ArrowRight') next = idx + 1
    else if (e.key === 'ArrowLeft') next = idx - 1
    else if (e.key === 'ArrowDown') next = idx + 3
    else if (e.key === 'ArrowUp') next = idx - 3
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = CELLS.length - 1
    if (next !== null) { e.preventDefault(); move(next) }
  }

  return (
    <div role="radiogroup" aria-label={meta.name} onKeyDown={onKeyDown}
      className="grid w-fit grid-cols-3 gap-1 rounded-md border border-border bg-muted/40 p-1">
      {CELLS.map((c, i) => {
        const active = c === current
        return (
          <button key={c} ref={(el) => { refs.current[i] = el }} type="button" role="radio"
            aria-checked={active} aria-label={c} tabIndex={active ? 0 : -1}
            onClick={() => onChange(c)}
            className={`size-6 rounded-sm transition-colors ${active ? 'bg-foreground' : 'bg-foreground/15 hover:bg-foreground/30'}`} />
        )
      })}
    </div>
  )
}
