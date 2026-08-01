import {
  createContext, useContext, useEffect, useState, useCallback, type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, ecodeToEmail, friendlyError } from '@/lib/supabase'
import type { Employee } from '@/types/db'

interface AuthState {
  session: Session | null
  employee: Employee | null
  /** Derived from having at least one direct report — there is no separate role. */
  isManager: boolean
  isHrAdmin: boolean
  /** Software administrator: sees every login's state, never a password. */
  isSwAdmin: boolean
  directReportCount: number
  /**
   * From the force_password_change setting. False during the testing phase,
   * so everyone signs in with ecode/ecode and goes straight to the app.
   */
  forcePasswordChange: boolean
  loading: boolean
  signIn: (ecode: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [directReportCount, setDirectReportCount] = useState(0)
  const [isHrAdmin, setIsHrAdmin] = useState(false)
  const [isSwAdmin, setIsSwAdmin] = useState(false)
  const [forcePasswordChange, setForcePasswordChange] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setEmployee(null)
      setDirectReportCount(0)
      setIsHrAdmin(false)
      setIsSwAdmin(false)
      return
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('*')
      .eq('auth_user_id', uid)
      .maybeSingle()

    setEmployee(emp ?? null)
    if (!emp) {
      setDirectReportCount(0)
      setIsHrAdmin(false)
      setIsSwAdmin(false)
      return
    }

    const [{ count }, { data: roles }, { data: setting }] = await Promise.all([
      supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('reporting_manager_id', emp.id)
        .eq('is_active', true),
      supabase.from('user_roles').select('role').eq('employee_id', emp.id),
      supabase.from('app_settings').select('value')
        .eq('key', 'force_password_change').maybeSingle(),
    ])

    const roleNames = (roles ?? []).map(r => r.role)
    setDirectReportCount(count ?? 0)
    setIsHrAdmin(roleNames.some(r => ['hr_admin', 'super_admin'].includes(r)))
    setIsSwAdmin(roleNames.some(r => ['sw_admin', 'super_admin'].includes(r)))
    setForcePasswordChange(setting?.value === true)
  }, [])

  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      if (alive) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!alive) return
      setSession(s)
      await loadProfile(s?.user.id)
      if (alive) setLoading(false)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (ecode: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: ecodeToEmail(ecode),
      password,
    })
    if (error) throw new Error(friendlyError(error))
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setEmployee(null)
  }, [])

  /**
   * Everyone starts with their ecode as the password, so the first login
   * must set a real one. Clearing must_change_password is what lets the
   * router stop redirecting them here.
   */
  const changePassword = useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw new Error(friendlyError(error))

    // Records that the password is no longer the one we issued. An RPC
    // rather than a direct update, so a client cannot simply claim it.
    const { error: e2 } = await supabase.rpc('mark_password_changed')
    if (e2) throw new Error(friendlyError(e2))
    if (employee) setEmployee({ ...employee, must_change_password: false })
  }, [employee])

  const refresh = useCallback(async () => {
    await loadProfile(session?.user.id)
  }, [loadProfile, session])

  return (
    <AuthContext.Provider
      value={{
        session,
        employee,
        isManager: directReportCount > 0,
        isHrAdmin,
        isSwAdmin,
        directReportCount,
        forcePasswordChange,
        loading,
        signIn,
        signOut,
        changePassword,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
