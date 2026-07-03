import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { currentTheme, toggleTheme } from './theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme)
  const onToggle = () => setTheme(toggleTheme())
  return (
    <SidebarMenuButton
      onClick={onToggle}
      aria-label="Toggle theme"
      tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}
