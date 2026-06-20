import { Navigate, Route, Routes } from 'react-router-dom'
import { Sidebar } from './shell/Sidebar'
import { Placeholder } from './screens/Placeholder'
import { ContentList } from './screens/ContentList'
import { Appearance } from './screens/Appearance'
import { EditorScreen } from './editor/EditorScreen'
import { Dashboard } from './screens/Dashboard'
import { Media } from './screens/Media'

export function App() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/posts" element={<ContentList collection="post" title="Posts" />} />
          <Route path="/pages" element={<ContentList collection="page" title="Pages" />} />
          <Route path="/media" element={<Media />} />
          <Route path="/forms" element={<Placeholder title="Forms" />} />
          <Route path="/appearance" element={<Appearance />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
          <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Routes>
      </main>
    </div>
  )
}
