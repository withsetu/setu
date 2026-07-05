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
        <Route path="/forms" element={<FormsInbox />} />
        <Route path="/appearance" element={<Appearance />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/health" element={<SiteHealth />} />
        <Route
          path="/edit/:collection/:locale/:slug"
          element={<EditorScreen />}
        />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </AppShell>
  )
}
