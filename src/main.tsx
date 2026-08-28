import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { ScoreThemeProvider } from '@/contexts/ScoreThemeContext'
import { guardNumberFields } from '@/lib/numberFields'
import { startTheme } from '@/lib/theme'
import { watchInstallability } from '@/lib/pwa'
import ErrorBoundary from '@/components/ErrorBoundary'
import App from './App'
import './index.css'

// Before anything renders, so no field is ever briefly unguarded.
guardNumberFields()
// Before render, so nobody sees a flash of the wrong palette, and so a
// choice made in another module is already in force when this one opens.
startTheme()
// And before React mounts, because beforeinstallprompt fires once and
// early — a component that has not rendered yet cannot catch it.
watchInstallability()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Appraisal figures change when a manager acts, not on a timer.
      // Refetch on focus so a manager's score appears without a reload.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Outermost, so a throw inside any provider is caught too — a
        blank page is the one outcome this must never allow. */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* The portal owns app.cyrix.in; this app owns /kpi beneath it.
            Without the basename every route would resolve one level too
            high and land on the portal's tiles. */}
        <BrowserRouter basename="/kpi">
          <AuthProvider>
            <ScoreThemeProvider>
              <App />
            </ScoreThemeProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
