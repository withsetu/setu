import { useState } from 'react'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { parseFrontmatterDate, formatFrontmatterDate } from '@setu/core'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'

/** The frontmatter date string → the local Date react-day-picker should highlight.
 *  The resolver reads date tokens in UTC, so we map the value's UTC calendar day onto a
 *  local Date — the calendar then shows (and formats) exactly the day that lands in the
 *  URL, with no timezone off-by-one for an existing `…T00:00:00.000Z` value. */
function toCalendarDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const ms = parseFrontmatterDate({ date: value })
  if (ms == null) return undefined
  const u = new Date(ms)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate())
}

export function DateField({
  value,
  onChange,
  editable
}: {
  value: string | undefined
  onChange: (next: string | undefined) => void
  editable: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = toCalendarDate(value)

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={!editable}
            className="h-9 flex-1 justify-start gap-2 font-normal"
          >
            <CalendarIcon className="size-4 opacity-70" aria-hidden="true" />
            {selected ? (
              format(selected, 'PP')
            ) : (
              <span className="text-muted-foreground">Set date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(d) => {
              onChange(d ? formatFrontmatterDate(d) : undefined)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {selected && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear date"
          disabled={!editable}
          className="size-9 shrink-0"
          onClick={() => onChange(undefined)}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  )
}
