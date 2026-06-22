import { Columns3 } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { ColumnKey } from './useColumnPrefs'

const ITEMS: { key: ColumnKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'tags', label: 'Tags' },
  { key: 'categories', label: 'Categories' },
  { key: 'locale', label: 'Locale' },
  { key: 'updated', label: 'Updated' },
]

export function ColumnsMenu({
  visible, toggle, showLocale,
}: { visible: Record<ColumnKey, boolean>; toggle: (k: ColumnKey) => void; showLocale: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm"><Columns3 className="size-4" />Columns</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ITEMS.filter((it) => it.key !== 'locale' || showLocale).map((it) => (
          <DropdownMenuCheckboxItem
            key={it.key}
            checked={visible[it.key]}
            onSelect={(e) => { e.preventDefault(); toggle(it.key) }}
          >
            {it.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
