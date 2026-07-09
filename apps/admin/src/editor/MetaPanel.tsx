import type { RenameResult, ResolvedPermalinkConfig } from '@setu/core'
import { CategoryField } from './CategoryField'
import { TagField } from './TagField'
import { FeaturedImageField } from './FeaturedImageField'
import { DateField } from './DateField'
import { SeoSection } from './SeoSection'
import { SlugField } from './SlugField'

/** The frontmatter value that feeds the permalink date tokens: `date` ?? `pubDate`. */
function dateValue(metadata: Record<string, unknown>): string | undefined {
  const raw = metadata['date'] ?? metadata['pubDate']
  return typeof raw === 'string'
    ? raw
    : raw instanceof Date
      ? raw.toISOString()
      : undefined
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border/60 px-[18px] py-[18px] last:border-b-0">
      <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function MetaPanel({
  metadata,
  collection,
  locale,
  slug,
  editable,
  committed,
  permalinkConfig,
  date,
  categories,
  onRename,
  renameBlockedReason,
  onChange,
  apiBase
}: {
  metadata: Record<string, unknown>
  collection: string
  locale: string
  slug: string
  editable: boolean
  /** Lifecycle past draft — renames move a live URL (301 messaging). */
  committed: boolean
  permalinkConfig: ResolvedPermalinkConfig
  /** Frontmatter publish date (epoch ms) for the permalink date tokens. */
  date: number | null
  categories: string[]
  onRename: (newSlug: string) => Promise<RenameResult>
  /** When set, applying a rename is disabled with this muted hint (UX only —
   *  the server enforces the same gate). */
  renameBlockedReason?: string
  onChange: (next: Record<string, unknown>) => void
  apiBase: string
}) {
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-border/60">
      <Section title="Permalink">
        <div className="space-y-3">
          <SlugField
            slug={slug}
            collection={collection}
            locale={locale}
            editable={editable}
            committed={committed}
            permalinkConfig={permalinkConfig}
            date={date}
            categories={categories}
            onRename={onRename}
            blockedReason={renameBlockedReason}
          />
          <div className="flex justify-between py-0.5 text-[13px]">
            <span className="text-muted-foreground">Locale</span>
            <span className="font-mono text-muted-foreground">{locale}</span>
          </div>
        </div>
      </Section>
      <Section title="Published">
        <DateField
          value={dateValue(metadata)}
          onChange={(next) => {
            const m = { ...metadata }
            if (next) m['date'] = next
            else delete m['date']
            onChange(m)
          }}
          editable={editable}
        />
      </Section>
      <Section title="Featured image">
        <FeaturedImageField
          value={
            typeof metadata['featuredImage'] === 'string'
              ? metadata['featuredImage']
              : undefined
          }
          onChange={(next) => {
            const m = { ...metadata }
            if (next) m['featuredImage'] = next
            else delete m['featuredImage']
            onChange(m)
          }}
          editable={editable}
          apiBase={apiBase}
        />
      </Section>
      <Section title="Categories">
        <CategoryField
          selected={
            Array.isArray(metadata['categories'])
              ? (metadata['categories'] as string[])
              : []
          }
          onChange={(next) => onChange({ ...metadata, categories: next })}
          editable={editable}
        />
      </Section>
      <Section title="Tags">
        <TagField
          selected={
            Array.isArray(metadata['tags'])
              ? (metadata['tags'] as string[])
              : []
          }
          onChange={(next) => onChange({ ...metadata, tags: next })}
          editable={editable}
        />
      </Section>
      <Section title="SEO">
        <SeoSection
          metadata={metadata}
          slug={slug}
          editable={editable}
          onChange={onChange}
          apiBase={apiBase}
        />
      </Section>
    </aside>
  )
}
