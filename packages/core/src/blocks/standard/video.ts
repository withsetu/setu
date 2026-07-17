import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** The `{% video %}` standard block (#178) — a self-hosted/uploaded video FILE rendered
 *  as a plain HTML5 <video> (edge-safe, zero server compute at render time). Provider
 *  embeds (YouTube/Vimeo/oEmbed) are the separate `{% embed %}` block, not this one. */
export const videoBlock: StandardBlock = {
  tag: 'video',
  renderer: '@setu/blocks/video.astro',
  contract: defineBlock({
    props: z.object({
      src: z.string(),
      poster: z.string().optional(),
      caption: z.string().optional(),
      controls: z.boolean().default(true),
      autoplay: z.boolean().default(false),
      loop: z.boolean().default(false),
      muted: z.boolean().default(false),
      width: z.enum(['none', 'wide', 'full']).default('none')
    }),
    editor: {
      label: 'Video',
      icon: 'video',
      group: 'media',
      keywords: ['mp4', 'movie', 'player', 'clip', 'webm', 'film'],
      style: { themeable: ['surface', 'text', 'radius', 'typography'] },
      controls: {
        src: 'video',
        poster: 'media',
        caption: 'text',
        controls: 'switch',
        autoplay: 'switch',
        loop: 'switch',
        muted: 'switch',
        width: 'align'
      },
      labels: {
        src: 'Video',
        poster: 'Poster Image',
        controls: 'Show Controls'
      },
      // Browsers refuse unmuted autoplay: while autoplay is on, the muted switch is
      // rendered forced-on and disabled (with the hint) so an author can never save a
      // silently-broken combination. The renderers apply the same coercion.
      forcedWhen: {
        muted: {
          when: { autoplay: true },
          value: true,
          hint: 'Autoplay requires muted playback — browsers block unmuted autoplay.'
        }
      },
      groups: [
        {
          id: 'content',
          label: 'Content',
          controls: ['src', 'poster', 'caption']
        },
        {
          id: 'playback',
          label: 'Playback',
          controls: ['controls', 'autoplay', 'muted', 'loop']
        },
        { id: 'layout', label: 'Layout', controls: ['width'] }
      ]
    }
  })
}
