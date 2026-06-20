// apps/admin/src/dashboard/use-dismissed.ts
import { useState } from 'react'

export function useDismissed(key: string): { dismissed: boolean; dismiss: () => void } {
  const storageKey = `setu.dismissed.${key}`
  const [dismissed, setDismissed] = useState<boolean>(() => localStorage.getItem(storageKey) === '1')
  const dismiss = () => {
    localStorage.setItem(storageKey, '1')
    setDismissed(true)
  }
  return { dismissed, dismiss }
}
