import { lazy, Suspense } from 'react'
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

// Demo Data panel (#513): DEV-ONLY — the ternary makes the dynamic import
// unreachable in production, so Vite/Rollup dead-code-eliminates the whole
// screen (verified by grepping the production bundle; same gating idea as the
// old floating dev-reset button this panel absorbs, #492). Lazy so even dev
// builds only load it when visited.
const DemoDataScreen = import.meta.env.DEV
  ? lazy(() =>
      import('./screens/demo/DemoDataScreen').then((m) => ({
        default: m.DemoDataScreen
      }))
    )
  : null

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
        {/* Cross-collection list (#604). Where the dashboard's Live/Staged/Drafts
            tiles land: they count post + page, so /posts could never show what
            they counted. Same screen, no collection scope. */}
        <Route path="/content" element={<ContentList title="All content" />} />
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
        {DemoDataScreen !== null && (
          <Route
            path="/demo-data"
            element={
              // users.delete = the admin-only action seeding honestly maps to
              // (it creates and hard-deletes accounts); the server enforces
              // the same action on every /api/demo route.
              <RequireCan action="users.delete">
                <Suspense fallback={null}>
                  <DemoDataScreen />
                </Suspense>
              </RequireCan>
            }
          />
        )}
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </AppShell>
  )
}
