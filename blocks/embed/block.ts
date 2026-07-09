import { defineBlock } from '@setu/core'
import { z } from 'zod'

/** Embed block (#187): an oEmbed-backed embed (YouTube, Vimeo, X, …). Shape A — the resolved
 *  oEmbed metadata is set by paste-to-embed (via POST /api/oembed → resolveOembed), not hand-typed;
 *  the author only edits presentation (caption / aspect ratio / width). The renderer stays pure:
 *  a sandboxed <iframe src=embedUrl> (or the srcdoc html fallback for script embeds), never a
 *  build-time fetch. Only `video` embeds feed the video sitemap (#367). */
export default defineBlock({
  props: z.object({
    // --- resolved oEmbed data (managed by the resolver; not inspector-edited) ---
    url: z.string(),
    provider: z.string().optional(),
    providerLabel: z.string().optional(),
    mediaType: z.enum(['video', 'audio', 'photo', 'rich']).optional(),
    oembedType: z.string().optional(),
    title: z.string().optional(),
    authorName: z.string().optional(),
    embedUrl: z.string().optional(),
    html: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    // --- author-editable presentation ---
    caption: z.string().optional(),
    ratio: z.enum(['auto', '16:9', '4:3', '1:1', '21:9']).default('auto'),
    align: z.enum(['none', 'wide', 'full']).default('none')
  }),
  editor: {
    label: 'Embed',
    icon: 'movie',
    group: 'embed',
    keywords: [
      'embed',
      'oembed',
      'url',
      'youtube',
      'vimeo',
      'video',
      'tweet',
      'link'
    ],
    // Only presentation is inspector-controlled; the resolved data props have no control (the
    // paste-to-embed flow sets them). ratio/align are pickers, caption a textarea.
    controls: { caption: 'textarea', ratio: 'select', align: 'align' },
    labels: { align: 'Width', ratio: 'Aspect ratio' },
    groups: [
      { id: 'content', label: 'Content', controls: ['caption'] },
      { id: 'layout', label: 'Layout', controls: ['ratio', 'align'] }
    ]
  }
})
