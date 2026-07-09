import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  Draft,
  DraftInput,
  Lifecycle,
  RenameResult,
  TiptapDoc
} from '@setu/core'
import {
  contentPath,
  createRenameService,
  isValidEntrySlug,
  parseFrontmatterDate,
  parseMdoc,
  resolvePermalinkConfig,
  serializeMdoc,
  tiptapToMarkdoc
} from '@setu/core'
import {
  ArchiveX,
  ChevronLeft,
  ExternalLink,
  Eye,
  Keyboard,
  Rocket,
  Save
} from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useServices } from '../data/store'
import { useCan } from '../auth/actor'
import { lifecycleFor } from '../lifecycle/useLifecycle'
import { useDeploy } from '../deploy/deploy'
import { StripStatus } from './StripStatus'
import { siteUrl } from '../shell/site-url'
import { useSettings } from '../data/settings-store'
import { useIndex } from '../data/index-store'
import { Canvas } from './Canvas'
import type { RunQuery } from './QueryPreview'
import { MetaPanel } from './MetaPanel'
import { BlockInspector } from './BlockInspector'
import { useSelectedBlock } from './useSelectedBlock'
import { PublishMenu } from './PublishMenu'
import { ShortcutsDialog } from './ShortcutsDialog'
import { Button } from '../components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../components/ui/tooltip'
import { useAutosave } from './useAutosave'
import type { SaveStatus } from './useAutosave'
import { SaveIndicator } from './SaveIndicator'
import { onRequestShortcuts } from './editor-events'
import {
  NEW_SLUG,
  mintSlug,
  composeInitialMetadata,
  existingSlugs,
  slugify,
  uniqueSlug
} from './new-entry'
import { useNotify } from '../ui/notify'
import { apiFetch } from '../lib/api-fetch'
import { useRegisterCommands } from '../command/registry'
import { attrString } from './attr-string'

const EDITOR_ID = 'local'
const BLANK: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
const OWNER_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

export function EditorScreen() {
  const { collection = '', locale = '', slug = '' } = useParams()
  const navigate = useNavigate()
  const { read, authoring, data, git, publish } = useServices()
  const { deployInfo, status: deployStatus } = useDeploy()
  const settings = useSettings()
  const index = useIndex()
  const can = useCan()
  // Best-effort reindex — never lets a failure surface to the editor. AWAIT it
  // on any path that reports "Saved"/success: a fire-and-forget index write can
  // be lost for good if the user hard-navigates right after (ensureBuilt only
  // heals when git HEAD moves, so a dropped DRAFT row stays missing — the
  // content-list visual flake was exactly this).
  const reindex = (r: typeof ref) => index.reindexEntry(r).catch(() => {})
  const ref = useMemo(
    () => ({ collection, locale, slug }),
    [collection, locale, slug]
  )
  // `new` is a compose sentinel: nothing is persisted until the first save mints a real slug.
  const composing = slug === NEW_SLUG

  const notify = useNotify()

  const [phase, setPhase] = useState<'loading' | 'ready' | 'readonly'>(
    'loading'
  )
  const [initialDoc, setInitialDoc] = useState<TiptapDoc>(BLANK)
  const [metadata, setMetadata] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [rev, setRev] = useState(0)
  const [lifecycle, setLifecycle] = useState<Lifecycle>({ state: 'draft' })
  const [liveCommitted, setLiveCommitted] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const selectedBlock = useSelectedBlock(editor)
  const apiBase = import.meta.env.VITE_SETU_API ?? ''
  // #382 WordPress-Contributor: a non-publisher can view a live post but never alter it
  // (the server enforces the same rule; this is the honest UI for it).
  const viewOnly = liveCommitted && !can('content.publish')
  const editable = phase === 'ready' && !viewOnly

  // Feeds the query block's in-canvas live preview with real index results (same query the
  // published block resolves at build time).
  const runQuery = useCallback<RunQuery>((q) => index.query(q), [index])

  useEffect(() => onRequestShortcuts(() => setShortcutsOpen(true)), [])

  const docRef = useRef<TiptapDoc>(BLANK)
  const metaRef = useRef<Record<string, unknown>>({})
  const baseShaRef = useRef<string | null>(null)
  const committing = useRef(false)
  // Slug just minted from a compose save OR just renamed → the in-memory doc is
  // canonical; don't reload over it.
  const mintedRef = useRef<string | null>(null)
  // Compose mode: a slug the author explicitly chose before the first save. The
  // ref feeds the mint (autosave closes over refs); the state re-renders the field.
  const manualSlugRef = useRef<string | null>(null)
  const [manualSlug, setManualSlug] = useState<string | null>(null)
  // The title whose slugified form the current slug was derived from — while they
  // still match (and nothing is committed), a title edit re-derives the slug.
  const loadedTitleRef = useRef('')
  // True while followRename is moving the entry: pauses autosave so a debounce
  // firing mid-move can't re-create the just-deleted old-ref draft.
  const renamingRef = useRef(false)
  const previewWin = useRef<Window | null>(null)
  const previewNonce = useRef(0)
  const previewApi = import.meta.env.VITE_SETU_API

  const refreshLifecycle = useCallback(async () => {
    const d = await data.getDraft(ref)
    setLifecycle(await lifecycleFor(ref, d, git, deployInfo()))
  }, [data, git, ref, deployInfo])

  useEffect(() => {
    let live = true
    // Arriving from a compose-mint or a rename (mintedRef holds this slug): the
    // in-memory doc/meta is canonical. The 'loading' phase still runs — the
    // keyed Canvas MUST unmount/remount to re-seed from the updated initialDoc
    // (skipping it once shipped an empty canvas: the new key mounted against
    // the stale blank initialDoc before this effect could set it).
    const justMinted = mintedRef.current === slug
    mintedRef.current = null
    setPhase('loading')
    void (async () => {
      if (composing) {
        // Blank body, editable, nothing persisted / no lock until the first save mints a
        // slug — but auto-stamp today's date so date-pattern permalinks resolve by default.
        const initialMeta = composeInitialMetadata()
        docRef.current = BLANK
        metaRef.current = initialMeta
        baseShaRef.current = null
        loadedTitleRef.current = ''
        manualSlugRef.current = null
        setManualSlug(null)
        if (!live) return
        setInitialDoc(BLANK)
        setMetadata(initialMeta)
        setRev(0)
        setStatus('idle')
        setLifecycle({ state: 'draft' })
        setLiveCommitted(false)
        setPhase('ready')
        return
      }
      // #382: the git.readFile is NOT redundant with loadForEdit's internal read — a stale
      // draft's baseContent can be older than HEAD; the live gate must reflect the CURRENT
      // committed state. No data dependency between the three, so run them in parallel.
      const [result, open, committed] = await Promise.all([
        read.loadForEdit(ref),
        authoring.open(ref, EDITOR_ID),
        // is this entry LIVE in Git? (committed and not published:false — same
        // fail-closed rule as the server's publishesLiveContent gate)
        git.readFile(contentPath(ref))
      ])
      const draft: Draft | null =
        result.source === 'absent' ? null : result.draft
      let isLive = false
      if (committed !== null) {
        try {
          isLive = parseMdoc(committed).frontmatter['published'] !== false
        } catch {
          isLive = true
        }
      }
      if (!live) return
      // justMinted (captured above): the in-memory doc/meta is canonical (may hold
      // keystrokes newer than the saved copy) — keep it instead of reloading over it.
      const content = justMinted ? docRef.current : (draft?.content ?? BLANK)
      const meta = justMinted ? metaRef.current : (draft?.metadata ?? {})
      docRef.current = content
      metaRef.current = meta
      // A rename sets baseShaRef to the move commit before navigating here —
      // keep it (compose-mint arrives with null, so this changes nothing there).
      baseShaRef.current = justMinted
        ? baseShaRef.current
        : (draft?.baseSha ?? null)
      loadedTitleRef.current = attrString(meta['title'])
      setInitialDoc(content)
      setMetadata(meta)
      setRev(0)
      // justMinted: leave status to useAutosave — forcing 'saved' here can beat
      // the still-in-flight mint/reindex and show "Saved" before the index row
      // is durable (the content-list lost-write race).
      if (!justMinted) setStatus('idle')
      setLiveCommitted(isLive)
      setPhase(open.granted ? 'ready' : 'readonly')
      void refreshLifecycle()
    })()
    return () => {
      live = false
    }
  }, [ref, read, authoring, git, refreshLifecycle, composing, slug])

  // When the global Deploy advances the live sha, re-derive so the pill updates.
  useEffect(() => {
    void refreshLifecycle()
  }, [deployStatus, refreshLifecycle])

  useAutosave({
    enabled: editable,
    rev,
    getInput: (): DraftInput => ({
      ...ref,
      content: docRef.current,
      metadata: metaRef.current,
      baseSha: baseShaRef.current
    }),
    save: async (input) => {
      // A rename is moving this entry right now: followRename already saved the
      // latest doc/meta to the OLD ref and the service is re-keying it — an
      // autosave firing in this window would resurrect the old draft.
      if (renamingRef.current) return { saved: true }
      if (composing) {
        // First save of a new entry: mint a real slug — the author's explicit
        // choice when they applied one, else derived from the title — persist
        // under it, and replace the URL so this becomes a normal entry.
        const newSlug = manualSlugRef.current
          ? uniqueSlug(
              manualSlugRef.current,
              await existingSlugs(data, git, collection, locale)
            )
          : await mintSlug(
              data,
              git,
              collection,
              locale,
              attrString(metaRef.current['title'])
            )
        mintedRef.current = newSlug
        const result = await authoring.save(
          {
            collection,
            locale,
            slug: newSlug,
            content: input.content,
            metadata: input.metadata,
            baseSha: null
          },
          EDITOR_ID
        )
        navigate(`/edit/${collection}/${locale}/${newSlug}`, { replace: true })
        await reindex({ collection, locale, slug: newSlug })
        return result
      }
      const result = await authoring.save(input, EDITOR_ID)
      await reindex(ref)
      return result
    },
    onStatus: setStatus
  })

  const onDocChange = (doc: TiptapDoc) => {
    docRef.current = doc
    setRev((r) => r + 1)
  }
  const onMetaChange = (next: Record<string, unknown>) => {
    metaRef.current = next
    setMetadata(next)
    setRev((r) => r + 1)
  }

  const renameService = useMemo(
    () => createRenameService({ data, git, author: OWNER_AUTHOR }),
    [data, git]
  )

  /** Move this entry to `newSlug` and follow it: keep the in-memory doc via the
   *  minted-slug mechanism, advance the publish base to the move commit, replace
   *  the URL, and reindex both identities. Refusals return to the field (inline
   *  error), successes toast. */
  const followRename = async (
    newSlug: string,
    opts: { silent?: boolean } = {}
  ): Promise<RenameResult> => {
    const wasCommitted = lifecycle.state !== 'draft'
    renamingRef.current = true
    try {
      // Save-before-rename (mirrors commit()'s save-before-publish): the service
      // moves what's in STORAGE, so persist the latest keystrokes first — and
      // autosave is paused (renamingRef) so a debounce firing mid-move can't
      // resurrect the old-ref draft after the service deletes it.
      await authoring.save(
        {
          ...ref,
          content: docRef.current,
          metadata: metaRef.current,
          baseSha: baseShaRef.current
        },
        EDITOR_ID
      )
      const result = await renameService.renameSlug(ref, newSlug)
      if (!result.renamed) return result
      mintedRef.current = newSlug
      if (result.committedSha) baseShaRef.current = result.committedSha
      navigate(`/edit/${collection}/${locale}/${newSlug}`, { replace: true })
      // Awaited: success (toast/return) must imply both index rows are settled,
      // or a hard navigation right after can lose the writes (see reindex doc).
      await Promise.all([
        reindex(ref),
        reindex({ collection, locale, slug: newSlug })
      ])
      // Same as publish: the move commit is now reflected in the index, so
      // advance the synced marker or the next ensureBuilt full-rebuilds.
      if (result.committedSha)
        await index.markSyncedAt(result.committedSha).catch(() => {})
      if (!opts.silent)
        notify.success(
          wasCommitted
            ? 'Slug renamed — the old URL will 301 after the next rebuild'
            : 'Slug renamed'
        )
      return result
    } finally {
      renamingRef.current = false
    }
  }

  const onRename = async (newSlug: string): Promise<RenameResult> => {
    if (composing) {
      // Nothing persisted yet — applying just records the author's choice; the
      // first autosave mints it. Same vocabulary as the rename service
      // (isValidEntrySlug), and availability is checked HERE so the author sees
      // "taken" instead of a silent -2 suffix; mint-time uniqueSlug stays as
      // the backstop for races.
      if (!isValidEntrySlug(newSlug))
        return { renamed: false, committedSha: null, reason: 'invalid-slug' }
      const taken = await existingSlugs(data, git, collection, locale)
      if (taken.has(newSlug))
        return { renamed: false, committedSha: null, reason: 'target-exists' }
      manualSlugRef.current = newSlug
      setManualSlug(newSlug)
      return { renamed: true, committedSha: null }
    }
    return followRename(newSlug)
  }

  /** Auto-derive the slug from the title on tab-out — only while the entry has
   *  never been committed AND the slug still equals what this title minted (a
   *  manual slug edit or a `-2` suffix breaks the equality and ends derivation). */
  const onTitleBlur = async () => {
    // Reviewed + waived: `lifecycle.state` is refreshed async after load, so for
    // a blink after mount it can read 'draft' for a committed entry. Practically
    // unreachable (a blur needs a focus + edit first, by which time the refresh
    // has landed), and the worst case is a silent draft-only re-key that the
    // next publish surfaces — never a lost commit.
    if (composing || phase !== 'ready' || lifecycle.state !== 'draft') return
    const derivedFromLoaded = slugify(loadedTitleRef.current) || 'untitled'
    if (slug !== derivedFromLoaded) return
    const newTitle = attrString(metaRef.current['title'])
    const base = slugify(newTitle)
    if (base === '' || base === slug) {
      loadedTitleRef.current = newTitle
      return
    }
    const taken = await existingSlugs(data, git, collection, locale)
    taken.delete(slug)
    const newSlug = uniqueSlug(base, taken)
    if (newSlug === slug) return
    // Best-effort: auto-derive silently skips on failure (the field still works
    // for an explicit rename, which surfaces its own errors).
    try {
      const result = await followRename(newSlug, { silent: true })
      if (result.renamed) loadedTitleRef.current = newTitle
    } catch {
      /* keep the current slug */
    }
  }
  const commit = async (opts?: {
    message?: string
    toast?: (sha: string) => string
  }) => {
    if (committing.current) return
    committing.current = true
    try {
      // Save-before-publish: publish reads storage, not the in-memory doc. Always
      // serialize the LATEST metaRef.current (Publish/Unpublish/Save-draft mutate
      // it first).
      await authoring.save(
        {
          ...ref,
          content: docRef.current,
          metadata: metaRef.current,
          baseSha: baseShaRef.current
        },
        EDITOR_ID
      )
      // Fire-and-forget is safe here: publish below re-reindexes + awaits.
      void reindex(ref)
      const r = await publish.publish({
        ref,
        author: OWNER_AUTHOR, // fallback only — the api stamps the session identity (#382)
        message: opts?.message
      })
      if (r.status === 'published') {
        baseShaRef.current = r.sha
        notify.success(
          opts?.toast ? opts.toast(r.sha) : 'Published · ' + r.sha.slice(0, 7)
        )
        // #382: this commit may have flipped published:false either way — re-derive
        // the live gate from the metadata just committed so Save draft/Publish-menu
        // state updates in place, without a reload.
        setLiveCommitted(metaRef.current['published'] !== false)
        await index.reindexEntry(ref).catch(() => {})
        await index.markSyncedAt(r.sha).catch(() => {})
        await refreshLifecycle()
      } else if (r.status === 'conflict') {
        notify.error('The published version moved — reload to continue.')
      }
    } finally {
      committing.current = false
    }
  }

  // Preview the CURRENT in-memory draft (unsaved edits included) through the real site theme:
  // compile it the same way publish does, push it to the api's preview slot, open/refresh the tab.
  const onPreview = async () => {
    if (!previewApi) return
    const content = serializeMdoc({
      frontmatter: metaRef.current,
      body: tiptapToMarkdoc(docRef.current)
    })
    await apiFetch(`${previewApi}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, collection, locale, slug })
    })
    // A changing nonce forces the named tab to navigate → re-fetch the just-pushed draft.
    const url = `${siteUrl()}/preview?n=${(previewNonce.current += 1)}`
    if (previewWin.current && !previewWin.current.closed) {
      previewWin.current.location.href = url
      previewWin.current.focus()
    } else {
      previewWin.current = window.open(url, 'setu-preview')
    }
  }

  // Publish always means go-live (#382): clear any published:false flag before
  // committing, so clicking Publish on a saved draft never re-commits the draft
  // state under a "Published" toast. This subsumes the old Re-publish action.
  const onPublish = () => {
    const m = { ...metaRef.current }
    delete m['published']
    metaRef.current = m
    setMetadata(m)
    void commit()
  }
  // WordPress-Contributor Save draft: commit the buffer to Git as published:false —
  // shared with the team, never live (#382).
  const onSaveDraft = () => {
    metaRef.current = { ...metaRef.current, published: false }
    setMetadata(metaRef.current)
    void commit({
      message: `Save draft ${collection}/${locale}/${slug}`,
      toast: (sha) => 'Draft saved · ' + sha.slice(0, 7)
    })
  }
  // Non-destructive: flag the draft published:false and commit (content stays in Git).
  const onUnpublish = () => {
    metaRef.current = { ...metaRef.current, published: false }
    setMetadata(metaRef.current)
    void commit()
  }
  const canSaveDraft =
    (can('content.edit') || can('content.create')) &&
    phase === 'ready' &&
    !composing &&
    !liveCommitted

  useRegisterCommands([
    {
      id: 'editor.publish',
      title: 'Publish',
      group: 'Editor',
      icon: Rocket,
      enabled: () => can('content.publish') && phase === 'ready' && !composing,
      run: () => onPublish()
    },
    {
      id: 'editor.saveDraft',
      title: 'Save draft',
      group: 'Editor',
      icon: Save,
      enabled: () =>
        (can('content.edit') || can('content.create')) &&
        phase === 'ready' &&
        !composing &&
        !liveCommitted,
      run: () => onSaveDraft()
    },
    {
      id: 'editor.preview',
      title: 'Preview draft',
      group: 'Editor',
      icon: Eye,
      enabled: () => Boolean(previewApi) && !composing,
      run: () => void onPreview()
    },
    {
      id: 'editor.unpublish',
      title: 'Unpublish',
      group: 'Editor',
      icon: ArchiveX,
      enabled: () =>
        can('content.unpublish') &&
        phase === 'ready' &&
        !composing &&
        metadata['published'] !== false,
      run: () => onUnpublish()
    }
  ])

  const title = attrString(metadata['title'])
  const listPath = `/${collection}s`
  // Same date ?? pubDate rule as the content index's dateOf — URL use only, never
  // updatedAt/mtime (an edit must not move a URL).
  const frontmatterDate = useMemo(
    () => parseFrontmatterDate(metadata),
    [metadata]
  )
  const frontmatterCategories = Array.isArray(metadata['categories'])
    ? (metadata['categories'] as string[])
    : []
  const permalinkConfig = resolvePermalinkConfig(
    collection,
    undefined,
    settings
  )
  // UX-only gate (the server's writeActionForChanges enforces regardless):
  // renaming a LIVE post moves a published URL — a commit an author can't make.
  const renameBlockedReason =
    !composing &&
    lifecycle.state !== 'draft' &&
    metadata['published'] !== false &&
    !can('content.publish')
      ? "Renaming a live post's URL requires publish permission"
      : undefined

  if (phase === 'loading') {
    return (
      <div className="editor">
        <p className="empty-state">Loading…</p>
      </div>
    )
  }

  return (
    <div className="editor">
      <div className="flex h-[52px] items-center gap-2 border-b border-border/60 px-3.5">
        {/* left */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon"
              aria-label="Back to list"
            >
              <Link to={listPath}>
                <ChevronLeft className="size-[18px]" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to list</TooltipContent>
        </Tooltip>
        <span className="text-[13.5px] text-muted-foreground">
          {composing ? `New ${collection}` : `${collection} / ${slug}`}
        </span>

        {/* center: save state only */}
        <div className="flex flex-1 justify-center">
          <SaveIndicator
            status={status}
            readonly={phase === 'readonly' || viewOnly}
          />
        </div>

        {/* right */}
        <StripStatus lifecycle={lifecycle} />
        <span className="mx-1 h-5 w-px bg-border" />

        {lifecycle.state === 'staged' || lifecycle.state === 'live' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label="View this page on the live site"
              >
                <a
                  href={siteUrl(
                    {
                      ...ref,
                      date: frontmatterDate,
                      categories: frontmatterCategories
                    },
                    permalinkConfig
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-[18px]" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>View this page on the live site</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* disabled button can't trigger hover; wrap in span so the tooltip still shows */}
              <span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled
                  aria-label="Not on the site yet — publish to view it live"
                >
                  <ExternalLink className="size-[18px]" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Not on the site yet — publish to view it live
            </TooltipContent>
          </Tooltip>
        )}

        {previewApi && !composing && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Preview the draft in your site theme"
                onClick={() => void onPreview()}
              >
                <Eye className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Preview the draft in your site theme
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Keyboard shortcuts"
              onClick={() => setShortcutsOpen(true)}
            >
              <Keyboard className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts</TooltipContent>
        </Tooltip>

        <PublishMenu
          canSaveDraft={canSaveDraft}
          canPublish={can('content.publish') && phase === 'ready' && !composing}
          canUnpublish={
            can('content.unpublish') && phase === 'ready' && !composing
          }
          isUnpublished={metadata['published'] === false}
          onSaveDraft={onSaveDraft}
          onPublish={onPublish}
          onUnpublish={onUnpublish}
        />
      </div>
      {phase === 'readonly' && (
        <div className="ed-banner" role="status">
          This entry is locked by another editor — viewing read-only.
        </div>
      )}
      {/* Suppress this banner when the lock banner above is already showing —
          only one role="status" ed-banner should render at a time, and the
          lock message is the more actionable one. */}
      {viewOnly && phase !== 'readonly' && (
        <div className="ed-banner" role="status">
          This post is live on the site. Your role can&apos;t change published
          posts — ask an editor to update or unpublish it.
        </div>
      )}
      <div className="editor-stage">
        <div className="ed-scroll">
          <div className="ed-canvas">
            <input
              className="ed-title"
              aria-label="Title"
              placeholder="Untitled"
              value={title}
              disabled={phase === 'readonly' || viewOnly}
              onChange={(e) =>
                onMetaChange({ ...metaRef.current, title: e.target.value })
              }
              onBlur={() => void onTitleBlur()}
            />
            <Canvas
              key={`${collection}/${locale}/${slug}`}
              initialContent={initialDoc}
              editable={editable}
              onChange={onDocChange}
              onEditor={setEditor}
              runQuery={runQuery}
            />
          </div>
        </div>
        {selectedBlock ? (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-border/60">
            <div className="flex flex-col gap-3 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Block · {selectedBlock.tag}
              </div>
              <BlockInspector
                tag={selectedBlock.tag}
                mdAttrs={selectedBlock.mdAttrs}
                onChange={selectedBlock.update}
                apiBase={apiBase}
              />
            </div>
          </aside>
        ) : (
          <MetaPanel
            metadata={metadata}
            collection={collection}
            locale={locale}
            slug={
              composing ? (manualSlug ?? (slugify(title) || 'untitled')) : slug
            }
            editable={editable}
            committed={lifecycle.state !== 'draft'}
            permalinkConfig={permalinkConfig}
            date={frontmatterDate}
            categories={frontmatterCategories}
            onRename={onRename}
            renameBlockedReason={renameBlockedReason}
            onChange={onMetaChange}
            apiBase={(import.meta.env.VITE_SETU_API as string) ?? ''}
          />
        )}
      </div>
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  )
}
