import { useMemo, useState } from 'react'
import type { RenameResult, ResolvedPermalinkConfig } from '@setu/core'
import { resolvePermalink } from '@setu/core'
import { Check, X } from 'lucide-react'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Button } from '../components/ui/button'
import { siteBaseUrl } from '../shell/site-url'
import { slugify } from './new-entry'

const REFUSAL_MESSAGES: Record<NonNullable<RenameResult['reason']>, string> = {
  'target-exists': 'Already used by another entry in this collection/locale.',
  'invalid-slug': 'Use lowercase letters, numbers, and hyphens.',
  absent: 'This entry no longer exists — reload and try again.',
  locked:
    'This entry is locked by another editor, so your changes could not be saved — nothing was renamed.',
  unchanged: ''
}

/** Editable slug with explicit-apply rename semantics: typing stages, Enter/✓
 *  applies (via `onRename`), Esc/✕ reverts. Nothing renames on blur — a slug is
 *  the entry's identity, so changing it is always an explicit act. */
export function SlugField({
  slug,
  collection,
  locale,
  editable,
  committed,
  permalinkConfig,
  date,
  categories,
  onRename,
  blockedReason
}: {
  slug: string
  collection: string
  locale: string
  editable: boolean
  /** Lifecycle past draft — the entry exists in Git, so a rename moves a URL. */
  committed: boolean
  permalinkConfig: ResolvedPermalinkConfig
  /** Frontmatter publish date (epoch ms) feeding the pattern's date tokens. */
  date: number | null
  categories: string[]
  onRename: (newSlug: string) => Promise<RenameResult>
  /** UX-only gate (the server enforces regardless): when set, applying is
   *  disabled and this text renders as a muted hint — e.g. an author lacking
   *  content.publish on a live post. */
  blockedReason?: string
}) {
  // null = untouched → the field tracks the slug prop (navigation after a
  // rename, compose-mode live derivation from the title); a string = the
  // user's staged edit, never clobbered by prop changes until apply/revert.
  const [staged, setStaged] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const text = staged ?? slug
  const clean = slugify(text)
  const dirty = text !== slug
  const canApply = dirty && clean !== '' && !applying && !blockedReason

  const revert = () => {
    setStaged(null)
    setError(null)
  }

  const apply = async () => {
    if (!canApply) return
    if (clean === slug) {
      revert()
      return
    }
    setApplying(true)
    try {
      const result = await onRename(clean)
      if (result.renamed) {
        // The parent navigates / re-derives; the prop change re-syncs us.
        setStaged(null)
        setError(null)
      } else if (result.reason && result.reason !== 'unchanged') {
        setError(REFUSAL_MESSAGES[result.reason])
      } else {
        revert()
      }
    } catch (e) {
      // A thrown rename (e.g. git-http non-2xx) must surface, never vanish:
      // keep the staged text so the author can retry or revert.
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        /\b403\b/.test(msg)
          ? "You don't have permission to rename a published post's URL."
          : `Rename failed — ${msg}`
      )
    } finally {
      setApplying(false)
    }
  }

  // Live full-URL preview through the real resolver — exactly the URL the site
  // will serve for the staged slug.
  const previewSlug = clean !== '' ? clean : slug
  const resolved = useMemo(
    () =>
      resolvePermalink(
        { collection, locale, slug: previewSlug, date, categories },
        permalinkConfig.pattern,
        { uncategorized: permalinkConfig.uncategorized }
      ),
    [collection, locale, previewSlug, date, categories, permalinkConfig]
  )
  const host = siteBaseUrl()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '')
  const noDateFallback = resolved.warnings.length > 0

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <Label
          htmlFor="meta-slug"
          className="text-[13px] font-normal text-muted-foreground"
        >
          Slug
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id="meta-slug"
            aria-label="Slug"
            aria-invalid={error !== null}
            className="h-8 font-mono text-[13px]"
            value={text}
            disabled={!editable || applying}
            onChange={(e) => {
              setStaged(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void apply()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                revert()
              }
            }}
          />
          {dirty && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Apply slug"
                disabled={!canApply}
                onClick={() => void apply()}
              >
                <Check className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Revert slug"
                disabled={applying}
                onClick={revert}
              >
                <X className="size-4" />
              </Button>
            </>
          )}
        </div>
        {dirty && clean !== '' && clean !== text.trim() && (
          <p className="text-[13px] text-muted-foreground">
            will save as: <span className="font-mono">{clean}</span>
          </p>
        )}
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        {blockedReason && (
          <p className="text-[13px] text-muted-foreground">{blockedReason}</p>
        )}
      </div>

      <p className="break-all font-mono text-[13px] leading-relaxed text-muted-foreground">
        {`${host}/${resolved.path}`}
      </p>

      {noDateFallback && (
        <p className="text-[13px] text-amber-600 dark:text-amber-500">
          {`No publish date — using /${previewSlug}`}
        </p>
      )}

      {committed && dirty && (
        <p className="text-[13px] text-muted-foreground">
          The old URL will redirect (301) after the next site rebuild.
        </p>
      )}
    </div>
  )
}
