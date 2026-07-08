import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app'
import { Bootstrap } from './data/Bootstrap'
import { resetToSampleContent } from './data/reset'
import { ActorProvider } from './auth/actor'
import { SessionGate } from './auth/SessionGate'
import { DeployProvider } from './deploy/deploy'
import { IndexProvider } from './data/index-store'
import { AppMediaIndexProvider } from './data/media-index-store'
import { TaxonomyProvider } from './data/taxonomy-store'
import { TagsProvider } from './data/tags-store'
import { NotificationProvider } from './ui/notify'
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

/** Dev-only escape hatch; compiled out of production by Vite. */
function DevReset() {
  if (!import.meta.env.DEV) return null
  return (
    <button
      type="button"
      className="dev-reset"
      onClick={() => {
        void resetToSampleContent()
      }}
    >
      Reset to sample content
    </button>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Bootstrap>
        <NotificationProvider>
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
          <DevReset />
          <Toaster position="bottom-right" />
        </NotificationProvider>
      </Bootstrap>
    </BrowserRouter>
  </StrictMode>
)
