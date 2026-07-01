import { CategoryField } from './CategoryField'
import { TagField } from './TagField'
import { FeaturedImageField } from './FeaturedImageField'
import { SeoSection } from './SeoSection'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 px-[18px] py-[18px] last:border-b-0">
      <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export function MetaPanel({
  metadata,
  locale,
  slug,
  editable,
  onChange,
  apiBase,
}: {
  metadata: Record<string, unknown>
  locale: string
  slug: string
  editable: boolean
  onChange: (next: Record<string, unknown>) => void
  apiBase: string
}) {
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-border/60">
      <Section title="Permalink">
        <div className="flex justify-between py-0.5 text-[13px]">
          <span className="text-muted-foreground">Slug</span>
          <span className="font-mono text-muted-foreground">/{slug}</span>
        </div>
        <div className="flex justify-between py-0.5 text-[13px]">
          <span className="text-muted-foreground">Locale</span>
          <span className="font-mono text-muted-foreground">{locale}</span>
        </div>
      </Section>
      <Section title="Featured image">
        <FeaturedImageField
          value={typeof metadata['featuredImage'] === 'string' ? (metadata['featuredImage'] as string) : undefined}
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
          selected={Array.isArray(metadata['categories']) ? (metadata['categories'] as string[]) : []}
          onChange={(next) => onChange({ ...metadata, categories: next })}
          editable={editable}
        />
      </Section>
      <Section title="Tags">
        <TagField
          selected={Array.isArray(metadata['tags']) ? (metadata['tags'] as string[]) : []}
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
