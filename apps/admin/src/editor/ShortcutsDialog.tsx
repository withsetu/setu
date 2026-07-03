import { SHORTCUTS, formatKeys, detectMac } from './shortcuts'
import type { ShortcutGroup } from './shortcuts'
import { BLOCK_TYPES } from './block-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const GROUP_ORDER: ShortcutGroup[] = ['Formatting', 'Links', 'Blocks', 'Help']

/** The keyboard-shortcuts cheat sheet (shadcn Dialog). Lists the registry grouped;
 *  closes on Esc, overlay click, or the built-in close button. */
export function ShortcutsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const mac = detectMac()

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>

        {GROUP_ORDER.map((group) => {
          const items = SHORTCUTS.filter((s) => s.group === group)
          if (items.length === 0) return null
          return (
            <section key={group} className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {group}
              </h3>
              {items.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm">{s.label}</span>
                  <span className="inline-flex items-center rounded border bg-muted px-1.5 text-xs font-mono">
                    {formatKeys(s.keys, mac)}
                  </span>
                </div>
              ))}
            </section>
          )
        })}

        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Turn a block into
          </h3>
          {BLOCK_TYPES.map((b) => (
            <div key={b.id} className="flex items-center justify-between py-1">
              <span className="text-sm">{b.label}</span>
              <span className="inline-flex items-center rounded border bg-muted px-1.5 text-xs font-mono">
                {formatKeys(b.keys, mac)}
              </span>
            </div>
          ))}
        </section>
      </DialogContent>
    </Dialog>
  )
}
