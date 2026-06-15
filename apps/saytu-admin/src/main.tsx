import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app'
import { DataProvider, createAppDataPort } from './data/store'
import { ActorProvider } from './auth/actor'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DataProvider adapter={createAppDataPort()}>
        <ActorProvider>
          <App />
        </ActorProvider>
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
)
