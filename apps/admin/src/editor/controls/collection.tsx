import { useCollections } from '../../data/collections-store'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { ControlProps } from './types'

/** Picker for a `collectionRef()` block prop (#1126) — the query block's "which content"
 *  source, after WordPress Query Loop's "Post type" dropdown. Fed by the site's declared
 *  collections (`useCollections` → `/api/collections`): shows each collection's plural label,
 *  stores its name. Covered by apps/admin/test/controls-collection.test.tsx and, for the real
 *  Radix portal, apps/admin/test-browser/control-interactions.test.tsx. */
export function CollectionControl({ value, onChange, meta }: ControlProps) {
  const { collections, loading, failed, reload } = useCollections()
  const fallback = typeof meta.default === 'string' ? meta.default : ''
  const val = typeof value === 'string' && value !== '' ? value : fallback
  const known = collections.some((c) => c.name === val)
  // A stored name the site does not declare (removed from setu.config, hand-edited file):
  // keep it visible and say why the build will reject it, rather than rendering a blank
  // trigger that hides the problem. Not while loading — the list is the built-in fallback.
  const undeclared = val !== '' && !known && !loading && !failed
  const id = `${meta.idPrefix ?? 'bi'}-${meta.name}`
  return (
    <div className="flex flex-col gap-1.5">
      <Select value={val} onValueChange={(v) => onChange(v)}>
        <SelectTrigger
          id={id}
          aria-label={meta.name}
          aria-describedby={undeclared || failed ? `${id}-note` : undefined}
          aria-invalid={undeclared || undefined}
          disabled={meta.disabled}
        >
          <SelectValue placeholder="Choose a collection" />
        </SelectTrigger>
        <SelectContent>
          {collections.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              {c.labelPlural}
            </SelectItem>
          ))}
          {val !== '' && !known && (
            <SelectItem value={val}>{val} (not declared)</SelectItem>
          )}
        </SelectContent>
      </Select>
      {undeclared && (
        <p id={`${id}-note`} className="text-sm text-destructive">
          “{val}” isn’t declared in setu.config, so the site build will reject
          this block. Pick a declared collection.
        </p>
      )}
      {failed && (
        <p
          id={`${id}-note`}
          className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
        >
          Couldn’t load the site’s collections — showing the built-ins only.
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            // reload() catches its own failure and re-sets `failed`, which keeps this note up.
            onClick={() => void reload()}
          >
            Retry
          </Button>
        </p>
      )}
    </div>
  )
}
