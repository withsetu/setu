import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { DeployButton } from './DeployButton'

interface NavItem {
  to: string
  label: string
  icon: IconName
}
interface NavGroup {
  group: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  { group: '', items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'Content',
    items: [
      { to: '/posts', label: 'Posts', icon: 'post' },
      { to: '/pages', label: 'Pages', icon: 'pages' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { to: '/media', label: 'Media', icon: 'image' },
      { to: '/forms', label: 'Forms', icon: 'forms' },
      { to: '/site', label: 'Site', icon: 'globe' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

function getTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function Sidebar() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getTheme)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('saytu-theme', next)
    } catch {
      // ignore (e.g. private mode)
    }
  }

  return (
    <aside className="sidebar surface-tx">
      <div className="sidebar-top">
        <div className="ws">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width={28} height={28} fill="none">
              <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
              <path
                d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
                stroke="var(--on-accent)"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="ws-meta">
            <span className="ws-name">Saytu</span>
            <span className="ws-sub">Local workspace</span>
          </span>
          <Icon name="chevDown" size={14} className="ws-chev" />
        </div>
      </div>

      <nav className="nav" aria-label="Primary">
        {NAV.map((g, i) => (
          <div className="nav-group-block" key={g.group || `g${i}`}>
            {g.group && <div className="nav-group">{g.group}</div>}
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}
              >
                <Icon name={item.icon} size={18} />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <DeployButton />
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}
