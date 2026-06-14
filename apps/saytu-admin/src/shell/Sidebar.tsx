import { useState } from 'react'
import { NavLink } from 'react-router-dom'

interface NavItem {
  to: string
  label: string
}
interface NavGroup {
  group: string
  items: NavItem[]
}

// PRD §24 information architecture.
const NAV: NavGroup[] = [
  { group: '', items: [{ to: '/dashboard', label: 'Dashboard' }] },
  {
    group: 'Content',
    items: [
      { to: '/posts', label: 'Posts' },
      { to: '/pages', label: 'Pages' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { to: '/media', label: 'Media' },
      { to: '/forms', label: 'Forms' },
      { to: '/site', label: 'Site' },
      { to: '/settings', label: 'Settings' },
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
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="logo-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width={26} height={26} fill="none">
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
        <span className="brand-name">Saytu</span>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((g, i) => (
          <div className="nav-group" key={g.group || `g${i}`}>
            {g.group && <div className="nav-group-label">{g.group}</div>}
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
    </aside>
  )
}
