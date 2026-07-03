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

type Kind = 'success' | 'error' | 'info'
interface Note {
  id: number
  kind: Kind
  message: string
}
export interface NotifyApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const NotifyContext = createContext<NotifyApi | null>(null)
const AUTODISMISS_MS = 4000
const MAX_VISIBLE = 4

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setNotes((ns) => ns.filter((n) => n.id !== id))
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = nextId.current++
      setNotes((ns) => [...ns, { id, kind, message }].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTODISMISS_MS)
      )
    },
    [dismiss]
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
    }
  }, [])

  const api = useMemo<NotifyApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m)
    }),
    [push]
  )

  return (
    <NotifyContext.Provider value={api}>
      {children}
      <div
        className="notify-region"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {notes.map((n) => (
          <div
            key={n.id}
            className={`notify notify-${n.kind}`}
            role={n.kind === 'error' ? 'alert' : 'status'}
          >
            <span className="notify-msg">{n.message}</span>
            <button
              type="button"
              className="notify-x"
              aria-label="Dismiss"
              onClick={() => dismiss(n.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  )
}

export function useNotify(): NotifyApi {
  const ctx = useContext(NotifyContext)
  if (ctx === null)
    throw new Error('useNotify must be used within a NotificationProvider')
  return ctx
}
