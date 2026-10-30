// First of all: storage the browser refuses must not crash the page (lib/safeStorage).
import './lib/safeStorage'
import { startSessionGuard } from '@/lib/sessionGuard'
import { startIdleSignOut } from '@/lib/idleSignOut'
import { supabase } from '@/lib/supabase'
import { startErrorReporting } from '@/lib/reportErrors'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { ScoreThemeProvider } from '@/contexts/ScoreThemeContext'
import { guardNumberFields } from '@/lib/numberFields'
import { startTheme } from '@/lib/theme'
import ErrorBoundary from '@/components/ErrorBoundary'
import App from './App'
import './index.css'

// Before anything renders, so no field is ever briefly unguarded.
guardNumberFields()
// Before render, so nobody sees a flash of the wrong palette, and so a
// choice made in another module is already in force when this one opens.
startTheme()
// Before React mounts, so an error during the first render is caught too (0230).
startErrorReporting(supabase, 'kpi', __BUILD_SHA__)

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

// Signed out within a minute when another device signs everybody out (0149).
startSessionGuard()
// Signed out after 3 hours with nothing done, across every Cyrix app.
startIdleSignOut(supabase)

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
