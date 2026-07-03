import { useEffect, useMemo, useState } from 'react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '@/components/ui/command'
import { useCommandRegistry, type CommandAction } from './registry'

const GROUP_ORDER = ['Editor', 'Create', 'Go to', 'Site']

function orderedGroups(actions: CommandAction[]): string[] {
  const groups = [...new Set(actions.map((a) => a.group))]
  return groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    if (ia !== -1 || ib !== -1)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.localeCompare(b)
  })
}

export function CommandPalette() {
  const { commands } = useCommandRegistry()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const isK = mod && !e.shiftKey && e.key.toLowerCase() === 'k'
      const isShiftP = mod && e.shiftKey && e.code === 'KeyP'
      if (isK || isShiftP) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Re-filter on every open so live `enabled()` values are always current.

  const enabled = useMemo(
    () => commands.filter((a) => a.enabled?.() !== false),
    [commands, open]
  )
  const groups = orderedGroups(enabled)

  const select = (a: CommandAction) => {
    setOpen(false)
    a.run()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search for a command to run"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {enabled
              .filter((a) => a.group === g)
              .map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.title} ${a.keywords ?? ''}`}
                  onSelect={() => select(a)}
                >
                  {a.icon && <a.icon className="size-4" />}
                  <span>{a.title}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
