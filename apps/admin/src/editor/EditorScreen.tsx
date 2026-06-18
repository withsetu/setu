import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Draft, DraftInput, Lifecycle, TiptapDoc } from '@setu/core'
import { Icon } from '../ui/Icon'
import { useServices } from '../data/store'
import { useCan } from '../auth/actor'
import { lifecycleFor } from '../lifecycle/useLifecycle'
import { lifecycleLabel } from '../lifecycle/label'
import { useDeploy } from '../deploy/deploy'
import { StatusPill } from '../ui/StatusPill'
import { Canvas } from './Canvas'
import { MetaPanel } from './MetaPanel'
import { PublishMenu } from './PublishMenu'
import { ShortcutsDialog } from './ShortcutsDialog'
import { useAutosave } from './useAutosave'
import type { SaveStatus } from './useAutosave'
import { onRequestShortcuts } from './editor-events'

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
  const { read, authoring, data, git, publish } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const can = useCan()
  const ref = useMemo(() => ({ collection, locale, slug }), [collection, locale, slug])

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

  const refreshLifecycle = useCallback(async () => {
    const d = await data.getDraft(ref)
    setLifecycle(await lifecycleFor(ref, d, git, deployedAt))
  }, [data, git, ref, deployedAt])

  useEffect(() => {
    let live = true
    setPhase('loading')
    void (async () => {
      const result = await read.loadForEdit(ref)
      const draft: Draft | null = result.source === 'absent' ? null : result.draft
      const open = await authoring.open(ref, EDITOR_ID)
      if (!live) return
      const content = draft?.content ?? BLANK
      const meta = draft?.metadata ?? {}
      docRef.current = content
      metaRef.current = meta
      baseShaRef.current = draft?.baseSha ?? null
      setInitialDoc(content)
      setMetadata(meta)
      setRev(0)
      setStatus('idle')
      setPhase(open.granted ? 'ready' : 'readonly')
      void refreshLifecycle()
    })()
    return () => {
      live = false
    }
  }, [ref, read, authoring, refreshLifecycle])

  // When the global Deploy advances the live sha, re-derive so the pill updates.
  useEffect(() => {
    void refreshLifecycle()
  }, [deploySha, refreshLifecycle])

  useAutosave({
    enabled: phase === 'ready',
    rev,
    getInput: (): DraftInput => ({ ...ref, content: docRef.current, metadata: metaRef.current, baseSha: baseShaRef.current }),
    save: (input) => authoring.save(input, EDITOR_ID),
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
          <Link className="strip-btn btn-icononly" to={listPath} aria-label="Back to list">
            <Icon name="chevLeft" size={18} />
          </Link>
          <span className="ed-breadcrumb">{collection} / {slug}</span>
        </div>
        <div className="ed-strip-center"><SaveIndicator status={status} readonly={phase === 'readonly'} /></div>
        <div className="ed-strip-right">
          {(() => { const { label, pending } = lifecycleLabel(lifecycle); return (
            <span className="ed-status"><StatusPill status={label} />{pending && <span className="status-pending">· {pending}</span>}</span>
          ) })()}
          <button
            type="button"
            className="strip-btn btn-icononly"
            aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <Icon name="keyboard" size={18} />
          </button>
          <PublishMenu
            canPublish={can('content.publish') && phase === 'ready'}
            canUnpublish={can('content.unpublish') && phase === 'ready'}
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
