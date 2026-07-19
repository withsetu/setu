import { Video } from '@setu/blocks'
import type { VideoProps } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'
import { attrStringOrUndefined } from '../attr-string'
import { createAtomBlock, atomCoreView } from './atom-block'

/** Map the video node's raw mdAttrs onto Video's props for the read-only canvas view.
 *  `src` and `poster` are `/media/…` paths resolved against the canvas media origin;
 *  booleans keep the same defaults the site's Video.astro applies (controls on unless
 *  explicitly false; autoplay/loop/muted off unless explicitly true). */
function videoProps(md: Record<string, unknown>, apiBase: string): VideoProps {
  const resolve = (attr: unknown): string | undefined => {
    const raw = attrStringOrUndefined(attr)
    return raw ? resolveMediaSrc(raw, apiBase || undefined) : undefined
  }
  return {
    src: resolve(md['src']),
    poster: resolve(md['poster']),
    caption: attrStringOrUndefined(md['caption']),
    controls: md['controls'] !== false,
    autoplay: md['autoplay'] === true,
    loop: md['loop'] === true,
    muted: md['muted'] === true,
    width: attrStringOrUndefined(md['width'])
  }
}

/** The `{% video %}` block — atom (props-only, no body); props edited in the inspector
 *  rail. Mirrors HeroBlock: mdAttrs JSON-only, kept out of the DOM, round-tripped by
 *  the core converter (to-tiptap maps video→videoBlock, to-markdoc emits self-closing).
 *  Node.create boilerplate + the shared canvas view come from the atom-block factory (#562). */
export const VideoBlock = createAtomBlock({
  name: 'videoBlock',
  dataAttr: 'data-setu-video-block',
  view: atomCoreView('video', Video, videoProps)
})
