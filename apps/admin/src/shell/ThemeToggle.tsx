import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { SidebarMenuButton } from '@/components/ui/sidebar'

function current(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(current)
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('setu-theme', next) } catch { /* private mode */ }
  }
  return (
    <SidebarMenuButton onClick={toggle} aria-label="Toggle theme" tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}
