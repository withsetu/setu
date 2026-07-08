import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { matchProvider } from '@setu/core'

export interface EmbedPasteOptions {
  /** API base (VITE_SETU_API) for the resolve call. */
  apiBase: string
}

/** Paste-to-embed (#187): paste a bare allow-listed provider URL and it auto-converts into an
 *  embed block — no slash menu, no manual insertion (the WordPress/Notion behaviour). Only a
 *  single-token provider URL is intercepted; anything else pastes normally. Resolution goes
 *  through POST /api/oembed (the matchProvider allowlist is the SSRF boundary, re-checked
 *  server-side). Async: the paste is handled immediately; the embed lands once resolved, and
 *  falls back to plain text if the provider can't be resolved. */
export const EmbedPaste = Extension.create<EmbedPasteOptions>({
  name: 'embedPaste',

  addOptions() {
    return { apiBase: '' }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const apiBase = this.options.apiBase
    return [
      new Plugin({
        key: new PluginKey('embedPaste'),
        props: {
          handlePaste(_view, event) {
            const text =
              event.clipboardData?.getData('text/plain')?.trim() ?? ''
            // Only a single-token, allow-listed provider URL is auto-embedded.
            if (!text || /\s/.test(text) || !matchProvider(text)) return false
            void resolveAndInsert(editor, apiBase, text)
            return true
          }
        }
      })
    ]
  }
})

async function resolveAndInsert(
  editor: Editor,
  apiBase: string,
  url: string
): Promise<void> {
  try {
    // Plain fetch (no credentials): matches the editor's other cross-origin API calls; the api
    // CORS returns `*`, which the browser rejects for credentialed requests. The cross-origin
    // session-cookie story is handled uniformly when auth (#248) + the single-origin proxy land.
    const res = await fetch(`${apiBase}/api/oembed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    })
    if (!res.ok) throw new Error(String(res.status))
    const { data } = (await res.json()) as { data: Record<string, unknown> }
    const md = {
      url: data.sourceUrl,
      provider: data.provider,
      providerLabel: data.providerLabel,
      mediaType: data.mediaType,
      oembedType: data.oembedType,
      title: data.title,
      authorName: data.authorName,
      embedUrl: data.embedUrl,
      html: data.html,
      thumbnailUrl: data.thumbnailUrl,
      width: data.width,
      height: data.height
    }
    const mdAttrs = Object.fromEntries(
      Object.entries(md).filter(([, v]) => v !== undefined && v !== null)
    )
    editor
      .chain()
      .focus()
      .insertContent({ type: 'embedBlock', attrs: { mdAttrs } })
      .run()
  } catch {
    // Resolution failed (unsupported/offline) — don't lose the paste; drop the URL as text.
    editor.chain().focus().insertContent(`${url} `).run()
  }
}
