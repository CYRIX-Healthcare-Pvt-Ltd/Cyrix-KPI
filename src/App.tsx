import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { PageLoader } from '@/components/ui'
import Shell from '@/components/Shell'
import Login from '@/pages/Login'
import ChangePassword from '@/pages/ChangePassword'
import Dashboard from '@/pages/Dashboard'

// Split off the heavier screens — recharts and the xlsx parser should not
// sit in the bundle a service engineer downloads just to log in on 4G.
const MyKpi             = lazy(() => import('@/pages/MyKpi'))
const KpiSetup          = lazy(() => import('@/pages/KpiSetup'))
const MonthlySubmission = lazy(() => import('@/pages/MonthlySubmission'))
const MyHistory         = lazy(() => import('@/pages/MyHistory'))
const Team              = lazy(() => import('@/pages/Team'))
const Approvals         = lazy(() => import('@/pages/Approvals'))
const ScoreSubmission   = lazy(() => import('@/pages/ScoreSubmission'))
const TeamMember        = lazy(() => import('@/pages/TeamMember'))

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, employee, loading } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />

  // Authenticated with Supabase but no employee row — the auth user was
  // created without being linked. Nothing is safe to show.
  if (!employee) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Account not linked</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your login exists but is not attached to an employee record. Please
          contact HR.
        </p>
      </div>
    )
  }

  // Initial password is the ecode itself, so force a real one before
  // anything else becomes reachable.
  if (employee.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return children
}

function RequireManager({ children }: { children: JSX.Element }) {
  const { isManager, isHrAdmin, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!isManager && !isHrAdmin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePassword />
            </RequireAuth>
          }
        />

        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="my-kpi" element={<MyKpi />} />
          <Route path="my-kpi/setup" element={<KpiSetup />} />
          <Route path="submission/:month" element={<MonthlySubmission />} />
          <Route path="history" element={<MyHistory />} />

          <Route
            path="team"
            element={
              <RequireManager>
                <Team />
              </RequireManager>
            }
          />
          <Route
            path="team/:employeeId"
            element={
              <RequireManager>
                <TeamMember />
              </RequireManager>
            }
          />
          <Route
            path="approvals"
            element={
              <RequireManager>
                <Approvals />
              </RequireManager>
            }
          />
          <Route
            path="score/:submissionId"
            element={
              <RequireManager>
                <ScoreSubmission />
              </RequireManager>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
