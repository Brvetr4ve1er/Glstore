/**
 * The signed-in customer — phone + one-time code, no password (Phase A).
 *
 *   const { customer, signedIn, loading, signIn, signOut } = useCustomer()
 *   <RequireCustomer>…</RequireCustomer>   → /login?next=… when signed out
 *
 * The token lives in localStorage (lib/api.ts attaches it to every request).
 * Any 401 on a request that carried it clears it and fires
 * SESSION_EXPIRED_EVENT, which this provider listens for — so an expired or
 * revoked session signs the shopper out everywhere, including other tabs.
 *
 * Account data belongs under React Query keys starting with 'account', so
 * signing out drops all of it in one call.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clearSessionToken, fetchMe, getSessionToken, logoutCustomer, setSessionToken,
  SESSION_EXPIRED_EVENT, type Customer, type CustomerSession,
} from '@/lib/api'
import { Spinner } from '@/components/ui'

export const ACCOUNT_QUERY_ROOT = 'account'
const ME_KEY = [ACCOUNT_QUERY_ROOT, 'me'] as const

interface CustomerContextValue {
  customer: Customer | null
  /** True only while a stored token is being checked. */
  loading: boolean
  signedIn: boolean
  signIn: (session: CustomerSession) => void
  signOut: () => Promise<void>
}

const CustomerContext = createContext<CustomerContextValue | null>(null)

export function CustomerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [token, setToken] = useState<string | null>(() => getSessionToken())

  useEffect(() => {
    const onExpired = () => {
      setToken(null)
      qc.removeQueries({ queryKey: [ACCOUNT_QUERY_ROOT] })
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'amc.session') setToken(getSessionToken())
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
      window.removeEventListener('storage', onStorage)
    }
  }, [qc])

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    enabled: token !== null,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const signIn = useCallback((session: CustomerSession) => {
    setSessionToken(session.token)
    qc.setQueryData(ME_KEY, session.customer)
    setToken(session.token)
  }, [qc])

  const signOut = useCallback(async () => {
    try {
      await logoutCustomer()
    } catch {
      // Already expired or revoked: the local sign-out below is what matters.
    }
    clearSessionToken()
    setToken(null)
    qc.removeQueries({ queryKey: [ACCOUNT_QUERY_ROOT] })
  }, [qc])

  const value = useMemo<CustomerContextValue>(() => ({
    customer: token ? me.data ?? null : null,
    loading: token !== null && me.isPending,
    signedIn: token !== null && !!me.data,
    signIn,
    signOut,
  }), [token, me.data, me.isPending, signIn, signOut])

  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>
}

export function useCustomer(): CustomerContextValue {
  const ctx = useContext(CustomerContext)
  if (!ctx) throw new Error('useCustomer must be used inside <CustomerProvider>')
  return ctx
}

/** Where to go after signing in. Only a same-site path is honoured — never an
 *  absolute or protocol-relative URL, or `?next=` becomes an open redirect. */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

export function loginPath(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`
}

export function RequireCustomer({ children }: { children: ReactNode }) {
  const { signedIn, loading } = useCustomer()
  const location = useLocation()
  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center" role="status" aria-label="Vérification de la session">
        <Spinner size={28} className="text-[var(--color-electric-blue)]" />
      </div>
    )
  }
  if (!signedIn) return <Navigate to={loginPath(location.pathname + location.search)} replace />
  return <>{children}</>
}
