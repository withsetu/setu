import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Draft, DraftInput, Lifecycle, TiptapDoc } from '@setu/core'
import { serializeMdoc, tiptapToMarkdoc } from '@setu/core'
import { Icon } from '../ui/Icon'
import { useServices } from '../data/store'
import { useCan } from '../auth/actor'
import { lifecycleFor } from '../lifecycle/useLifecycle'
import { lifecycleLabel } from '../lifecycle/label'
import { useDeploy } from '../deploy/deploy'
import { StatusPill } from '../ui/StatusPill'
import { siteUrl } from '../shell/site-url'
import { Canvas } from './Canvas'
import { MetaPanel } from './MetaPanel'
import { PublishMenu } from './PublishMenu'
import { ShortcutsDialog } from './ShortcutsDialog'
import { Tooltip } from './Tooltip'
import { useAutosave } from './useAutosave'
import type { SaveStatus } from './useAutosave'
import { onRequestShortcuts } from './editor-events'
import { NEW_SLUG, mintSlug } from './new-entry'

const EDITOR_ID = 'local'
const BLANK: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
const OWNER_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

function SaveIndicator({ status, readonly }: { status: SaveStatus; readonly: boolean }) {
  if (readonly) return <span className="autosave saving">Read-only</span>
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Draft'
  return <span className={`autosave${status === 'saving' ? ' saving' : ''}`}>{label}</span>
}

export function EditorScreen() {
  const { collection = '', locale = '', slug = '' } = useParams()
  const navigate = useNavigate()
  const { read, authoring, data, git, publish } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const can = useCan()
  const ref = useMemo(() => ({ collection, locale, slug }), [collection, locale, slug])
  // `new` is a compose sentinel: nothing is persisted until the first save mints a real slug.
  const composing = slug === NEW_SLUG

  const [phase, setPhase] = useState<'loading' | 'ready' | 'readonly'>('loading')
  const [initialDoc, setInitialDoc] = useState<TiptapDoc>(BLANK)
  const [metadata, setMetadata] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [rev, setRev] = useState(0)
  const [lifecycle, setLifecycle] = useState<Lifecycle>({ state: 'draft' })
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => onRequestShortcuts(() => setShortcutsOpen(true)), [])

  const docRef = useRef<TiptapDoc>(BLANK)
  const metaRef = useRef<Record<string, unknown>>({})
  const baseShaRef = useRef<string | null>(null)
  const committing = useRef(false)
  // Slug just minted from a compose save → the in-memory doc is canonical; don't reload over it.
  const mintedRef = useRef<string | null>(null)
  const previewWin = useRef<Window | null>(null)
  const previewNonce = useRef(0)
  const previewApi = import.meta.env.VITE_SETU_API as string | undefined

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
      const draft: Draft | null = result.source === 'absent' ? null : result.draft
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
    getInput: (): DraftInput => ({ ...ref, content: docRef.current, metadata: metaRef.current, baseSha: baseShaRef.current }),
    save: async (input) => {
      if (composing) {
        // First save of a new entry: mint a real slug from the title, persist under it, and
        // replace the URL so this becomes a normal entry (each "New" → its own draft).
        const newSlug = await mintSlug(data, git, collection, locale, String(metaRef.current['title'] ?? ''))
        mintedRef.current = newSlug
        const result = await authoring.save(
          { collection, locale, slug: newSlug, content: input.content, metadata: input.metadata, baseSha: null },
          EDITOR_ID,
        )
        navigate(`/edit/${collection}/${locale}/${newSlug}`, { replace: true })
        return result
      }
      return authoring.save(input, EDITOR_ID)
    },
    onStatus: setStatus,
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
    setPublishMsg(null)
    try {
      // Save-before-publish: publish reads storage, not the in-memory doc. Always
      // serialize the LATEST metaRef.current (Unpublish/Re-publish mutate it first).
      await authoring.save({ ...ref, content: docRef.current, metadata: metaRef.current, baseSha: baseShaRef.current }, EDITOR_ID)
      const r = await publish.publish({ ref, author: OWNER_AUTHOR })
      if (r.status === 'published') {
        baseShaRef.current = r.sha
        setPublishMsg('Published · ' + r.sha.slice(0, 7))
        await refreshLifecycle()
      } else if (r.status === 'conflict') {
        setPublishMsg('The published version moved — reload to continue.')
      } else {
        setPublishMsg(null)
      }
    } finally {
      committing.current = false
    }
  }

  // Preview the CURRENT in-memory draft (unsaved edits included) through the real site theme:
  // compile it the same way publish does, push it to the api's preview slot, open/refresh the tab.
  const onPreview = async () => {
    if (!previewApi) return
    const content = serializeMdoc({ frontmatter: metaRef.current, body: tiptapToMarkdoc(docRef.current) })
    await fetch(`${previewApi}/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, collection, locale, slug }),
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

  const title = String(metadata['title'] ?? '')
  const listPath = `/${collection}s`

  if (phase === 'loading') {
    return <div className="editor"><p className="empty-state">Loading…</p></div>
  }

  return (
    <div className="editor">
      <div className="ed-strip">
        <div className="ed-strip-left">
          <Tooltip content="Back to list">
            <Link className="strip-btn btn-icononly" to={listPath} aria-label="Back to list">
              <Icon name="chevLeft" size={18} />
            </Link>
          </Tooltip>
          <span className="ed-breadcrumb">{composing ? `New ${collection}` : `${collection} / ${slug}`}</span>
        </div>
        <div className="ed-strip-center"><SaveIndicator status={status} readonly={phase === 'readonly'} /></div>
        <div className="ed-strip-right">
          {(() => { const { label, pending } = lifecycleLabel(lifecycle); return (
            <span className="ed-status"><StatusPill status={label} />{pending && <span className="status-pending">· {pending}</span>}</span>
          ) })()}
          {lifecycle.state === 'staged' || lifecycle.state === 'live' ? (
            <Tooltip content="View this page on the live site">
              <a
                className="strip-btn btn-icononly"
                href={siteUrl(ref)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View this page on the live site"
              >
                <Icon name="external" size={18} />
              </a>
            </Tooltip>
          ) : (
            // Disabled buttons don't fire tippy's hover, so the tooltip targets a wrapper span.
            <Tooltip content="Not on the site yet — publish to view it live">
              <span className="strip-tipwrap">
                <button
                  type="button"
                  className="strip-btn btn-icononly"
                  disabled
                  aria-label="Not on the site yet — publish to view it live"
                >
                  <Icon name="external" size={18} />
                </button>
              </span>
            </Tooltip>
          )}
          {previewApi && !composing && (
            <Tooltip content="Preview the draft in your site theme">
              <button
                type="button"
                className="strip-btn btn-icononly"
                aria-label="Preview the draft in your site theme"
                onClick={() => void onPreview()}
              >
                <Icon name="eye" size={18} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Keyboard shortcuts">
            <button
              type="button"
              className="strip-btn btn-icononly"
              aria-label="Keyboard shortcuts"
              onClick={() => setShortcutsOpen(true)}
            >
              <Icon name="keyboard" size={18} />
            </button>
          </Tooltip>
          <PublishMenu
            canPublish={can('content.publish') && phase === 'ready' && !composing}
            canUnpublish={can('content.unpublish') && phase === 'ready' && !composing}
            isUnpublished={metadata['published'] === false}
            onPublish={onPublish}
            onUnpublish={onUnpublish}
            onRepublish={onRepublish}
          />
          {publishMsg && <span className="publish-msg">{publishMsg}</span>}
        </div>
      </div>
      {phase === 'readonly' && (
        <div className="ed-banner" role="status">This entry is locked by another editor — viewing read-only.</div>
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
              onChange={(e) => onMetaChange({ ...metaRef.current, title: e.target.value })}
            />
            <Canvas key={`${collection}/${locale}/${slug}`} initialContent={initialDoc} editable={phase === 'ready'} onChange={onDocChange} />
          </div>
        </div>
        <MetaPanel metadata={metadata} locale={locale} slug={slug} editable={phase === 'ready'} onChange={onMetaChange} />
      </div>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}
