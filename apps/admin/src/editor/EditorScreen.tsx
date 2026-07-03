import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Draft, DraftInput, Lifecycle, TiptapDoc } from '@setu/core'
import { serializeMdoc, tiptapToMarkdoc } from '@setu/core'
import {
  ArchiveX,
  ChevronLeft,
  ExternalLink,
  Eye,
  Keyboard,
  Rocket
} from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useServices } from '../data/store'
import { useCan } from '../auth/actor'
import { lifecycleFor } from '../lifecycle/useLifecycle'
import { useDeploy } from '../deploy/deploy'
import { StripStatus } from './StripStatus'
import { siteUrl } from '../shell/site-url'
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
import { NEW_SLUG, mintSlug } from './new-entry'
import { useNotify } from '../ui/notify'
import { useRegisterCommands } from '../command/registry'
import { attrString } from './attr-string'

const EDITOR_ID = 'local'
const BLANK: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
const OWNER_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

export function EditorScreen() {
  const { collection = '', locale = '', slug = '' } = useParams()
  const navigate = useNavigate()
  const { read, authoring, data, git, publish } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const index = useIndex()
  const can = useCan()
  // Best-effort reindex — never lets a failure surface to the editor.
  const reindex = (r: typeof ref) => void index.reindexEntry(r).catch(() => {})
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const selectedBlock = useSelectedBlock(editor)
  const apiBase = import.meta.env.VITE_SETU_API ?? ''

  // Feeds the query block's in-canvas live preview with real index results (same query the
  // published block resolves at build time).
  const runQuery = useCallback<RunQuery>((q) => index.query(q), [index])

  useEffect(() => onRequestShortcuts(() => setShortcutsOpen(true)), [])

  const docRef = useRef<TiptapDoc>(BLANK)
  const metaRef = useRef<Record<string, unknown>>({})
  const baseShaRef = useRef<string | null>(null)
  const committing = useRef(false)
  // Slug just minted from a compose save → the in-memory doc is canonical; don't reload over it.
  const mintedRef = useRef<string | null>(null)
  const previewWin = useRef<Window | null>(null)
  const previewNonce = useRef(0)
  const previewApi = import.meta.env.VITE_SETU_API

  const refreshLifecycle = useCallback(async () => {
    const d = await data.getDraft(ref)
    setLifecycle(await lifecycleFor(ref, d, git, deployedAt))
  }, [data, git, ref, deployedAt])

  useEffect(() => {
    let live = true
    setPhase('loading')
    void (async () => {
      if (composing) {
        // Blank, editable, nothing persisted / no lock until the first save mints a slug.
        docRef.current = BLANK
        metaRef.current = {}
        baseShaRef.current = null
        if (!live) return
        setInitialDoc(BLANK)
        setMetadata({})
        setRev(0)
        setStatus('idle')
        setLifecycle({ state: 'draft' })
        setPhase('ready')
        return
      }
      const result = await read.loadForEdit(ref)
      const draft: Draft | null =
        result.source === 'absent' ? null : result.draft
      const open = await authoring.open(ref, EDITOR_ID)
      if (!live) return
      // Just minted this slug from a compose save: the in-memory doc/meta is canonical (may hold
      // keystrokes newer than the saved copy) — keep it instead of reloading over it.
      const justMinted = mintedRef.current === slug
      mintedRef.current = null
      const content = justMinted ? docRef.current : (draft?.content ?? BLANK)
      const meta = justMinted ? metaRef.current : (draft?.metadata ?? {})
      docRef.current = content
      metaRef.current = meta
      baseShaRef.current = justMinted ? null : (draft?.baseSha ?? null)
      setInitialDoc(content)
      setMetadata(meta)
      setRev(0)
      setStatus(justMinted ? 'saved' : 'idle')
      setPhase(open.granted ? 'ready' : 'readonly')
      void refreshLifecycle()
    })()
    return () => {
      live = false
    }
  }, [ref, read, authoring, refreshLifecycle, composing, slug])

  // When the global Deploy advances the live sha, re-derive so the pill updates.
  useEffect(() => {
    void refreshLifecycle()
  }, [deploySha, refreshLifecycle])

  useAutosave({
    enabled: phase === 'ready',
    rev,
    getInput: (): DraftInput => ({
      ...ref,
      content: docRef.current,
      metadata: metaRef.current,
      baseSha: baseShaRef.current
    }),
    save: async (input) => {
      if (composing) {
        // First save of a new entry: mint a real slug from the title, persist under it, and
        // replace the URL so this becomes a normal entry (each "New" → its own draft).
        const newSlug = await mintSlug(
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
        reindex({ collection, locale, slug: newSlug })
        return result
      }
      const result = await authoring.save(input, EDITOR_ID)
      reindex(ref)
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
  const commit = async () => {
    if (committing.current) return
    committing.current = true
    try {
      // Save-before-publish: publish reads storage, not the in-memory doc. Always
      // serialize the LATEST metaRef.current (Unpublish/Re-publish mutate it first).
      await authoring.save(
        {
          ...ref,
          content: docRef.current,
          metadata: metaRef.current,
          baseSha: baseShaRef.current
        },
        EDITOR_ID
      )
      reindex(ref)
      const r = await publish.publish({ ref, author: OWNER_AUTHOR })
      if (r.status === 'published') {
        baseShaRef.current = r.sha
        notify.success('Published · ' + r.sha.slice(0, 7))
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
    await fetch(`${previewApi}/preview`, {
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

  const onPublish = () => void commit()
  // Non-destructive: flag the draft published:false and commit (content stays in Git).
  const onUnpublish = () => {
    metaRef.current = { ...metaRef.current, published: false }
    setMetadata(metaRef.current)
    void commit()
  }
  const onRepublish = () => {
    const m = { ...metaRef.current }
    delete m['published']
    metaRef.current = m
    setMetadata(m)
    void commit()
  }

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
          <SaveIndicator status={status} readonly={phase === 'readonly'} />
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
                  href={siteUrl(ref)}
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
          canPublish={can('content.publish') && phase === 'ready' && !composing}
          canUnpublish={
            can('content.unpublish') && phase === 'ready' && !composing
          }
          isUnpublished={metadata['published'] === false}
          onPublish={onPublish}
          onUnpublish={onUnpublish}
          onRepublish={onRepublish}
        />
      </div>
      {phase === 'readonly' && (
        <div className="ed-banner" role="status">
          This entry is locked by another editor — viewing read-only.
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
              disabled={phase === 'readonly'}
              onChange={(e) =>
                onMetaChange({ ...metaRef.current, title: e.target.value })
              }
            />
            <Canvas
              key={`${collection}/${locale}/${slug}`}
              initialContent={initialDoc}
              editable={phase === 'ready'}
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
            locale={locale}
            slug={slug}
            editable={phase === 'ready'}
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
