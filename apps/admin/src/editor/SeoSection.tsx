import { useState } from 'react'
import { resolveSeo } from '@setu/core'
import { useSettings } from '../data/settings-store'
import { FeaturedImageField } from './FeaturedImageField'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface SeoOverride {
  title?: string
  description?: string
  image?: string
  noindex?: boolean
  canonical?: string
}

// Google shows ~60 chars of title and ~155 of description; nudge (not block) past these.
const TITLE_MAX = 60
const DESC_MAX = 155

function Counter({ len, max }: { len: number; max: number }) {
  return (
    <span
      className={`text-[11px] tabular-nums ${len > max ? 'text-amber-600' : 'text-muted-foreground'}`}
    >
      {len}/{max}
    </span>
  )
}

export function SeoSection({
  metadata,
  slug,
  editable,
  onChange,
  apiBase
}: {
  metadata: Record<string, unknown>
  slug: string
  editable: boolean
  onChange: (next: Record<string, unknown>) => void
  apiBase: string
}) {
  const settings = useSettings()
  const [advanced, setAdvanced] = useState(false)

  const seo = (
    metadata['seo'] && typeof metadata['seo'] === 'object'
      ? metadata['seo']
      : {}
  ) as SeoOverride
  const docTitle =
    typeof metadata['title'] === 'string' ? metadata['title'] : ''
  const docDesc =
    (typeof metadata['description'] === 'string' && metadata['description']) ||
    (typeof metadata['summary'] === 'string' && metadata['summary']) ||
    ''

  const set = (patch: Partial<SeoOverride>) => {
    const next: Record<string, unknown> = { ...seo, ...patch }
    for (const k of Object.keys(next)) {
      const v = next[k]
      if (v === '' || v === undefined || v === false) delete next[k]
    }
    const m = { ...metadata }
    if (Object.keys(next).length) m['seo'] = next
    else delete m['seo']
    onChange(m)
  }

  // Snippet preview — resolve through the SAME @setu/core resolver the site uses, so what the editor
  // shows is exactly what ships (title template, site-name suffix, description fallbacks).
  const resolved = resolveSeo(settings, {
    title: seo.title || docTitle,
    description: seo.description || docDesc || undefined,
    canonical: `${settings.identity.url || 'https://example.com'}/${slug}`
  })
  const previewTitle = resolved.title
  const previewDesc =
    resolved.meta.find((m) => m.name === 'description')?.content ||
    'Add a meta description to control the search snippet.'
  const previewUrl = `${(settings.identity.url || 'example.com').replace(/^https?:\/\//, '').replace(/\/$/, '')} › ${slug}`

  return (
    <div className="space-y-3.5">
      {/* Google-style search snippet preview */}
      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
        <div className="truncate text-[12px] text-emerald-700 dark:text-emerald-500">
          {previewUrl}
        </div>
        <div className="truncate text-[15px] leading-snug text-blue-700 dark:text-blue-400">
          {previewTitle}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
          {previewDesc}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="seo-title">SEO title</Label>
          <Counter len={(seo.title || '').length} max={TITLE_MAX} />
        </div>
        <Input
          id="seo-title"
          value={seo.title || ''}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={docTitle || 'Defaults to the page title'}
          disabled={!editable}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="seo-desc">Meta description</Label>
          <Counter len={(seo.description || '').length} max={DESC_MAX} />
        </div>
        <Textarea
          id="seo-desc"
          rows={3}
          value={seo.description || ''}
          onChange={(e) => set({ description: e.target.value })}
          placeholder={
            docDesc || 'Falls back to the excerpt, then the site description.'
          }
          disabled={!editable}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Social share image</Label>
        <FeaturedImageField
          value={seo.image}
          onChange={(next) => set({ image: next })}
          editable={editable}
          apiBase={apiBase}
        />
      </div>

      <button
        type="button"
        className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? '▾' : '▸'} Advanced
      </button>

      {advanced && (
        <div className="space-y-3.5 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="seo-noindex">Hide from search engines</Label>
              <p className="text-[11px] text-muted-foreground">
                Emits <code>noindex, nofollow</code> for this page.
              </p>
            </div>
            <Switch
              id="seo-noindex"
              checked={!!seo.noindex}
              onCheckedChange={(c) => set({ noindex: c })}
              disabled={!editable}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seo-canonical">Canonical URL</Label>
            <Input
              id="seo-canonical"
              value={seo.canonical || ''}
              onChange={(e) => set({ canonical: e.target.value })}
              placeholder="Leave blank to use this page's URL"
              disabled={!editable}
            />
          </div>
        </div>
      )}
    </div>
  )
}
