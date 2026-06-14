import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Draft, DraftInput, TiptapDoc } from '@saytu/core'
import { useServices } from '../data/store'
import { Canvas } from './Canvas'
import { MetaPanel } from './MetaPanel'
import { useAutosave } from './useAutosave'
import type { SaveStatus } from './useAutosave'

const EDITOR_ID = 'local'
const BLANK: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function SaveIndicator({ status, readonly }: { status: SaveStatus; readonly: boolean }) {
  if (readonly) return <span className="autosave saving">Read-only</span>
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Draft'
  return <span className={`autosave${status === 'saving' ? ' saving' : ''}`}>{label}</span>
}

export function EditorScreen() {
  const { collection = '', locale = '', slug = '' } = useParams()
  const { read, authoring } = useServices()
  const ref = useMemo(() => ({ collection, locale, slug }), [collection, locale, slug])

  const [phase, setPhase] = useState<'loading' | 'ready' | 'readonly'>('loading')
  const [initialDoc, setInitialDoc] = useState<TiptapDoc>(BLANK)
  const [metadata, setMetadata] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [rev, setRev] = useState(0)

  const docRef = useRef<TiptapDoc>(BLANK)
  const metaRef = useRef<Record<string, unknown>>({})
  const baseShaRef = useRef<string | null>(null)

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
    })()
    return () => {
      live = false
    }
  }, [ref, read, authoring])

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
  const title = String(metadata['title'] ?? '')

  if (phase === 'loading') {
    return <div className="editor"><p className="empty-state">Loading…</p></div>
  }

  return (
    <div className="editor">
      <div className="ed-strip">
        <div className="ed-strip-left"><span className="ed-breadcrumb">{collection} / {slug}</span></div>
        <div className="ed-strip-center"><SaveIndicator status={status} readonly={phase === 'readonly'} /></div>
        <div className="ed-strip-right" />
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
    </div>
  )
}
