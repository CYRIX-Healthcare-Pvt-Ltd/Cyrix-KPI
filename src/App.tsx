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
const Profile           = lazy(() => import('@/pages/Profile'))
const Team              = lazy(() => import('@/pages/Team'))
const TeamAnalysis      = lazy(() => import('@/pages/TeamAnalysis'))
const Approvals         = lazy(() => import('@/pages/Approvals'))
const ScoreSubmission   = lazy(() => import('@/pages/ScoreSubmission'))
const TeamMember        = lazy(() => import('@/pages/TeamMember'))
const AdminOverview     = lazy(() => import('@/pages/admin/AdminOverview'))
const AdminEmployees    = lazy(() => import('@/pages/admin/AdminEmployees'))
const AdminReports      = lazy(() => import('@/pages/admin/AdminReports'))
const AdminRequests     = lazy(() => import('@/pages/admin/AdminRequests'))
const SwAdmin           = lazy(() => import('@/pages/admin/SwAdmin'))
const KpiTiming         = lazy(() => import('@/pages/admin/KpiTiming'))
const DeletionRequests  = lazy(() => import('@/pages/DeletionRequests'))

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, employee, loading, forcePasswordChange } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />

  // Authenticated with Supabase but no employee row — the auth user was
  // created without being linked. Nothing is safe to show.
  if (!employee) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Account not linked</h1>
        <p className="mt-2 text-sm text-ink-600">
          Your login exists but is not attached to an employee record. Please
          contact HR.
        </p>
      </div>
    )
  }

  // Normally the initial password is the ecode itself, so a real one is
  // forced before anything else becomes reachable. Disabled during the
  // testing phase via the force_password_change setting.
  if (
    forcePasswordChange &&
    employee.must_change_password &&
    location.pathname !== '/change-password'
  ) {
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

function RequireHr({ children }: { children: JSX.Element }) {
  const { isHrAdmin, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!isHrAdmin) return <Navigate to="/" replace />
  return children
}

function RequireSw({ children }: { children: JSX.Element }) {
  const { isSwAdmin, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!isSwAdmin) return <Navigate to="/" replace />
  return children
}

/**
 * HR administers the system rather than being appraised by it, so they
 * land on the admin overview instead of a personal dashboard.
 */
function HomeRoute() {
  const { isHrAdmin, isSwAdmin, loading } = useAuth()
  if (loading) return <PageLoader />
  if (isHrAdmin) return <Navigate to="/admin" replace />
  if (isSwAdmin) return <Navigate to="/admin/logins" replace />
  return <Dashboard />
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
          <Route index element={<HomeRoute />} />
          <Route path="my-kpi" element={<MyKpi />} />
          <Route path="my-kpi/setup" element={<KpiSetup />} />
          <Route path="submission/:month" element={<MonthlySubmission />} />
          <Route path="history" element={<MyHistory />} />
          {/* Everyone has a record, including HR and SW Admin — the page
              shows a rank only to those the system actually appraises. */}
          <Route path="me" element={<Profile />} />

          <Route path="team" element={<RequireManager><Team /></RequireManager>} />
          <Route path="team/analysis" element={<RequireManager><TeamAnalysis /></RequireManager>} />
          <Route path="team/:employeeId" element={<RequireManager><TeamMember /></RequireManager>} />
          <Route path="approvals" element={<RequireManager><Approvals /></RequireManager>} />
          <Route path="score/:submissionId" element={<RequireManager><ScoreSubmission /></RequireManager>} />

          <Route path="admin" element={<RequireHr><AdminOverview /></RequireHr>} />
          <Route path="admin/employees" element={<RequireHr><AdminEmployees /></RequireHr>} />
          <Route path="admin/reports" element={<RequireHr><AdminReports /></RequireHr>} />
          <Route path="admin/requests" element={<RequireHr><AdminRequests /></RequireHr>} />
          <Route path="admin/logins" element={<RequireSw><SwAdmin /></RequireSw>} />
          {/* When the clock starts is a rollout decision, so it sits with
              the people who ran the rollout rather than with the people
              the clock reports on. */}
          <Route path="admin/timing" element={<RequireSw><KpiTiming /></RequireSw>} />
          {/* The approval chain is the reporting manager and then HR. The
              link was removed from the SW Admin nav, but a nav is not a
              permission — the route has to say so too. */}
          <Route
            path="deletions"
            element={<RequireManager><DeletionRequests /></RequireManager>}
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
