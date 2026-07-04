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

/** Route-level defense-in-depth for `/users` (#248): the sidebar nav item is already gated on
 *  `users.manage` (AppSidebar), but a direct URL visit must be re-checked here too — mirrors
 *  Settings.tsx's render-time re-check for its (now-removed) Users group. Falls back to the
 *  dashboard rather than rendering a gated screen. */
function UsersRoute() {
  const can = useCan()
  if (!can('users.manage')) return <Navigate to="/dashboard" replace />
  return <UsersScreen />
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/posts" element={<ContentList collection="post" title="Posts" />} />
        <Route path="/pages" element={<ContentList collection="page" title="Pages" />} />
        <Route path="/taxonomies" element={<Taxonomies />} />
        <Route path="/categories" element={<Navigate to="/taxonomies" replace />} />
        <Route path="/media" element={<Media />} />
        <Route path="/forms" element={<FormsInbox />} />
        <Route path="/appearance" element={<Appearance />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<UsersRoute />} />
        <Route path="/health" element={<SiteHealth />} />
        <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </AppShell>
  )
}
