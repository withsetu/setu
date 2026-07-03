import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface CommandAction {
  id: string
  title: string
  group: string
  keywords?: string
  icon?: LucideIcon
  run: () => void
  enabled?: () => boolean
}

interface RegistryValue {
  register: (actions: CommandAction[]) => () => void
  commands: CommandAction[]
}

const CommandRegistryContext = createContext<RegistryValue | null>(null)

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<string, CommandAction>>(() => new Map())
  const register = useCallback((incoming: CommandAction[]) => {
    setMap((prev) => {
      const next = new Map(prev)
      for (const a of incoming) next.set(a.id, a)
      return next
    })
    return () =>
      setMap((prev) => {
        const next = new Map(prev)
        for (const a of incoming) next.delete(a.id)
        return next
      })
  }, [])
  const value = useMemo<RegistryValue>(
    () => ({ register, commands: [...map.values()] }),
    [register, map]
  )
  return (
    <CommandRegistryContext.Provider value={value}>
      {children}
    </CommandRegistryContext.Provider>
  )
}

export function useCommandRegistry(): RegistryValue {
  const ctx = useContext(CommandRegistryContext)
  if (ctx === null)
    throw new Error(
      'useCommandRegistry must be used within a CommandRegistryProvider'
    )
  return ctx
}

/** Register `actions` while the calling component is mounted. Static fields (title/
 *  group/icon/keywords) are captured at mount; `run`/`enabled` delegate to a live
 *  ref so they always see the latest closures — no stale capture, and we register
 *  exactly once (no render loop). */
export function useRegisterCommands(actions: CommandAction[]): void {
  const { register } = useCommandRegistry()
  const ref = useRef(actions)
  ref.current = actions
  useEffect(() => {
    const wrapped: CommandAction[] = ref.current.map((a) => ({
      id: a.id,
      title: a.title,
      group: a.group,
      keywords: a.keywords,
      icon: a.icon,
      run: () => ref.current.find((x) => x.id === a.id)?.run(),
      enabled: () => ref.current.find((x) => x.id === a.id)?.enabled?.() ?? true
    }))
    return register(wrapped)
  }, [register])
}
