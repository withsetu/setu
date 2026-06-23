import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app'
import { Bootstrap } from './data/Bootstrap'
import { resetToSampleContent } from './data/reset'
import { ActorProvider } from './auth/actor'
import { DeployProvider } from './deploy/deploy'
import { IndexProvider } from './data/index-store'
import { AppMediaIndexProvider } from './data/media-index-store'
import { TaxonomyProvider } from './data/taxonomy-store'
import { TagsProvider } from './data/tags-store'
import { NotificationProvider } from './ui/notify'
import { Toaster } from '@/components/ui/sonner'
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

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
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Bootstrap>
        <NotificationProvider>
          <ActorProvider>
            <DeployProvider>
              <IndexProvider>
                <AppMediaIndexProvider>
                  <TaxonomyProvider>
                    <TagsProvider>
                      <App />
                    </TagsProvider>
                  </TaxonomyProvider>
                </AppMediaIndexProvider>
              </IndexProvider>
            </DeployProvider>
          </ActorProvider>
          <DevReset />
          <Toaster position="bottom-right" />
        </NotificationProvider>
      </Bootstrap>
    </BrowserRouter>
  </StrictMode>,
)
