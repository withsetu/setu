import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { RouteBoundary } from './shell/RouteBoundary'
import { Placeholder } from './screens/Placeholder'
import { ContentList } from './screens/ContentList'
import { Dashboard } from './screens/Dashboard'
import { useCan } from './auth/actor'
import type { Action } from '@setu/core'

// Route-level code splitting (#597). The admin shipped as ONE 622 kB-gzipped chunk:
// the whole Tiptap + Markdoc + day-picker editor stack downloaded before the
// dashboard could paint, for every visit, even a visit that never opens an entry.
// Everything below the landing surface (dashboard + the content lists reachable from
// it) is therefore a dynamic import, using the same `lazy()` pattern the DEV-only
// demo panel already used. `RouteBoundary` (one Suspense + error boundary around the
// whole outlet) supplies the loading frame and the honest chunk-load failure state —
// this is a pure load optimization, no route behaves differently.
//
// Eager on purpose: AppShell, Dashboard and ContentList are the first paint and the
// navigation the user makes next; splitting those would trade bytes for a spinner on
// the hottest path.
const Appearance = lazy(() =>
  import('./screens/Appearance').then((m) => ({ default: m.Appearance }))
)
const EditorScreen = lazy(() =>
  import('./editor/EditorScreen').then((m) => ({ default: m.EditorScreen }))
)
const Media = lazy(() =>
  import('./screens/Media').then((m) => ({ default: m.Media }))
)
const Taxonomies = lazy(() =>
  import('./screens/taxonomies/Taxonomies').then((m) => ({
    default: m.Taxonomies
  }))
)
const FormsInbox = lazy(() =>
  import('./screens/FormsInbox').then((m) => ({ default: m.FormsInbox }))
)
const Settings = lazy(() =>
  import('./screens/settings/Settings').then((m) => ({ default: m.Settings }))
)
const SiteHealth = lazy(() =>
  import('./screens/SiteHealth').then((m) => ({ default: m.SiteHealth }))
)
const UsersScreen = lazy(() =>
  import('./screens/users/UsersScreen').then((m) => ({
    default: m.UsersScreen
  }))
)

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
      <RouteBoundary>
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
          <Route
            path="/content"
            element={<ContentList title="All content" />}
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
          {DemoDataScreen !== null && (
            <Route
              path="/demo-data"
              element={
                // users.delete = the admin-only action seeding honestly maps to
                // (it creates and hard-deletes accounts); the server enforces
                // the same action on every /api/demo route.
                <RequireCan action="users.delete">
                  <DemoDataScreen />
                </RequireCan>
              }
            />
          )}
          <Route path="*" element={<Placeholder title="Page not found" />} />
        </Routes>
      </RouteBoundary>
    </AppShell>
  )
}
