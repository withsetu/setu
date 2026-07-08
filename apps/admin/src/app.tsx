import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { Placeholder } from './screens/Placeholder'
import { ContentList } from './screens/ContentList'
import { Appearance } from './screens/Appearance'
import { EditorScreen } from './editor/EditorScreen'
import { Dashboard } from './screens/Dashboard'
import { Media } from './screens/Media'
import { Taxonomies } from './screens/taxonomies/Taxonomies'
import { FormsInbox } from './screens/FormsInbox'
import { Settings } from './screens/settings/Settings'
import { SiteHealth } from './screens/SiteHealth'
import { UsersScreen } from './screens/users/UsersScreen'
import { useCan } from './auth/actor'
import type { Action } from '@setu/core'

/** Route-level defense-in-depth (#362): the sidebar already hides nav items an actor lacks the
 *  capability for (AppSidebar), but a direct URL visit must be re-checked here too. Falls back to
 *  the dashboard rather than rendering a gated screen. The server re-enforces every underlying API
 *  call regardless — this is UX, not the security boundary. */
function RequireCan({
  action,
  children
}: {
  action: Action
  children: React.ReactNode
}) {
  const can = useCan()
  if (!can(action)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route
          path="/posts"
          element={<ContentList collection="post" title="Posts" />}
        />
        <Route
          path="/pages"
          element={<ContentList collection="page" title="Pages" />}
        />
        <Route path="/taxonomies" element={<Taxonomies />} />
        <Route
          path="/categories"
          element={<Navigate to="/taxonomies" replace />}
        />
        <Route path="/media" element={<Media />} />
        <Route
          path="/forms"
          element={
            <RequireCan action="forms.view">
              <FormsInbox />
            </RequireCan>
          }
        />
        <Route
          path="/appearance"
          element={
            <RequireCan action="theme.manage">
              <Appearance />
            </RequireCan>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireCan action="settings.view">
              <Settings />
            </RequireCan>
          }
        />
        <Route
          path="/users"
          element={
            <RequireCan action="users.view">
              <UsersScreen />
            </RequireCan>
          }
        />
        <Route
          path="/health"
          element={
            <RequireCan action="sitehealth.view">
              <SiteHealth />
            </RequireCan>
          }
        />
        <Route
          path="/edit/:collection/:locale/:slug"
          element={<EditorScreen />}
        />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </AppShell>
  )
}
