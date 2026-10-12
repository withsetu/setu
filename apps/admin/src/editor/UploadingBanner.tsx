import { Loader2 } from 'lucide-react'

/** The editor's status while an image uploads (#840): the "Saving…" indicator's spinner and
 *  type, as a pill pinned to the top of the canvas so it stays in view while the author scrolls. */
export function UploadingBanner() {
  return (
    <div
      role="status"
      className="pointer-events-none sticky top-3 z-10 mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-[13px] text-muted-foreground shadow-sm backdrop-blur"
    >
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Uploading
      image…
    </div>
  )
}
