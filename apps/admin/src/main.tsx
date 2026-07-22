import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app'
import { Bootstrap } from './data/Bootstrap'
import { ActorProvider } from './auth/actor'
import { SessionGate } from './auth/SessionGate'
import { DeployProvider } from './deploy/deploy'
import { IndexProvider } from './data/index-store'
import { AppMediaIndexProvider } from './data/media-index-store'
import { TaxonomyProvider } from './data/taxonomy-store'
import { TagsProvider } from './data/tags-store'
import { NotificationProvider } from './ui/notify'
import { UnhandledRejectionReporter } from './ui/UnhandledRejectionReporter'
import { CommandRegistryProvider } from './command/registry'
import { SettingsProvider } from './data/settings-store'
import { Toaster } from '@/components/ui/sonner'
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

// Topology decision (#248 Task 6): SessionGate — and real Better Auth sessions generally — only
// make sense when the admin talks to a real api (VITE_SETU_API set). In the no-API in-browser
// mode (Bootstrap's fallback: no server, content lives entirely in IndexedDB — e.g. a pure static
// preview build) there is no api to hold a session, no capabilities.auth to consult, and nothing
// to authenticate against, so the gate is skipped entirely and ActorProvider keeps its existing
// single local-owner default. Toggling this per-build (not per-request) is intentional: which
// topology the admin is compiled for is a build-time fact, not something that changes at runtime.
const hasApi = !!import.meta.env.VITE_SETU_API

/** Wraps children in SessionGate only in the API-connected topology; otherwise passes children
 *  through under the existing local-owner ActorProvider untouched. */
function AuthBoundary({ children }: { children: ReactNode }) {
  if (!hasApi) return <ActorProvider>{children}</ActorProvider>
  return <SessionGate>{children}</SessionGate>
}

// The old floating dev-only "Reset to sample content" button lived here; it
// overlapped the sidebar user menu (#492) and is absorbed by the Demo Data
// panel's Reset section (#513) — /demo-data, DEV builds only.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Bootstrap>
        <NotificationProvider>
          {/* Outside AuthBoundary so it is listening before the session
              resolves — a failing sign-in exchange is exactly the kind of
              rejection nothing else reports. */}
          <UnhandledRejectionReporter />
          <AuthBoundary>
            <DeployProvider>
              <IndexProvider>
                <AppMediaIndexProvider>
                  <TaxonomyProvider>
                    <TagsProvider>
                      <CommandRegistryProvider>
                        <SettingsProvider>
                          <App />
                        </SettingsProvider>
                      </CommandRegistryProvider>
                    </TagsProvider>
                  </TaxonomyProvider>
                </AppMediaIndexProvider>
              </IndexProvider>
            </DeployProvider>
          </AuthBoundary>
          <Toaster position="bottom-right" />
        </NotificationProvider>
      </Bootstrap>
    </BrowserRouter>
  </StrictMode>
)
