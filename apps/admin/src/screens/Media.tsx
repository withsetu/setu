import { useState } from 'react'
import { PageHeader } from '../shell/PageHeader'
import { uploadFile, type UploadResult } from '../media/upload-client'

export function Media() {
  const apiBase = import.meta.env.VITE_SETU_API as string | undefined
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    try {
      setResult(await uploadFile(apiBase ?? '', file))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <section className="media">
      <PageHeader title="Media" subtitle="Upload a file and get a link." />
      <input data-testid="media-file-input" type="file" onChange={onPick} disabled={busy} />
      {busy && <p className="muted">Uploading…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="media-result">
          {result.contentType.startsWith('image/') && (
            <img src={result.url} alt={result.filename} style={{ maxWidth: 320, display: 'block' }} />
          )}
          <a href={result.url} target="_blank" rel="noreferrer">{result.filename}</a>
        </div>
      )}
    </section>
  )
}
