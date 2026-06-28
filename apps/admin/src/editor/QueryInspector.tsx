import { LayoutGrid, Rows3 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { CategoryControl, TagControl } from './inspector-controls'

const COLLECTIONS: { value: string; label: string }[] = [
  { value: 'post', label: 'Posts' },
  { value: 'page', label: 'Pages' },
]

const SORTS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title (A–Z)' },
]

/** A labelled section of the inspector (Content / Layout / Pagination). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** A single labelled field. `inline` lays the control out to the right of the label (for
 *  switches), otherwise the control sits under the label. */
function Field({ label, htmlFor, inline, children }: { label: string; htmlFor?: string; inline?: boolean; children: React.ReactNode }) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {children}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/** Dedicated, grouped inspector for the `{% query %}` block — the WordPress-Query-Loop-grade
 *  panel: dropdowns + searchable taxonomy pickers + a segmented layout toggle + a columns
 *  slider, paired with the live in-canvas preview. No raw-slug typing, no skeletons. */
export function QueryInspector({
  mdAttrs,
  onChange,
}: {
  mdAttrs: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}) {
  const collection = String(mdAttrs.collection ?? 'post')
  const category = String(mdAttrs.category ?? '')
  const tag = String(mdAttrs.tag ?? '')
  const sort = String(mdAttrs.sort ?? 'newest')
  const layout = String(mdAttrs.layout ?? 'grid')
  const columns = Math.min(6, Math.max(1, Number(mdAttrs.columns ?? 3)))
  const showImage = Boolean(mdAttrs.showImage ?? true)
  const limit = Number(mdAttrs.limit ?? 10)
  const offset = Number(mdAttrs.offset ?? 0)

  const num = (raw: string): number | '' => (raw === '' ? '' : Math.max(0, Number(raw)))

  return (
    <div className="flex flex-col gap-4">
      <Section title="Content">
        <Field label="Source" htmlFor="qi-collection">
          <Select value={collection} onValueChange={(v) => onChange('collection', v)}>
            <SelectTrigger id="qi-collection" aria-label="Source collection"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COLLECTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Category" htmlFor="qi-category">
          <CategoryControl id="qi-category" value={category} onChange={(v) => onChange('category', v)} />
        </Field>

        <Field label="Tag">
          <TagControl value={tag} onChange={(v) => onChange('tag', v)} />
        </Field>

        <Field label="Order by" htmlFor="qi-sort">
          <Select value={sort} onValueChange={(v) => onChange('sort', v)}>
            <SelectTrigger id="qi-sort" aria-label="Order by"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section title="Layout">
        <Field label="Display">
          <ToggleGroup
            type="single"
            variant="outline"
            value={layout}
            onValueChange={(v) => { if (v) onChange('layout', v) }}
            className="w-full"
            aria-label="Layout"
          >
            <ToggleGroupItem value="grid" aria-label="Grid" className="flex-1 gap-1.5">
              <LayoutGrid className="size-4" /> Grid
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List" className="flex-1 gap-1.5">
              <Rows3 className="size-4" /> List
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        {layout === 'grid' && (
          <Field label={`Columns — ${columns}`} htmlFor="qi-columns">
            <Slider
              id="qi-columns"
              aria-label="Columns"
              min={1}
              max={6}
              step={1}
              value={[columns]}
              onValueChange={([v]) => onChange('columns', v)}
            />
          </Field>
        )}

        <Field label="Show featured image" htmlFor="qi-showimage" inline>
          <Switch id="qi-showimage" aria-label="Show featured image" checked={showImage} onCheckedChange={(v) => onChange('showImage', v)} />
        </Field>
      </Section>

      <Section title="Pagination">
        <Field label="Number of posts" htmlFor="qi-limit">
          <Input
            id="qi-limit"
            aria-label="Number of posts"
            type="number"
            min={1}
            max={50}
            value={String(limit)}
            onChange={(e) => onChange('limit', num(e.target.value))}
          />
        </Field>

        <Field label="Skip first" htmlFor="qi-offset">
          <Input
            id="qi-offset"
            aria-label="Skip first"
            type="number"
            min={0}
            value={String(offset)}
            onChange={(e) => onChange('offset', num(e.target.value))}
          />
        </Field>
      </Section>
    </div>
  )
}
