import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { login as apiLogin, type TokenOut } from './api'

interface AuthCtx {
  token: string | null
  role: string | null
  email: string | null
  isAuthed: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

function parseJwt(token: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return {} }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('gl_token'))
  const [role, setRole]   = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  // Hydrate from stored token on mount
  useEffect(() => {
    if (!token) return
    const p = parseJwt(token)
    if ((p.exp as number) * 1000 < Date.now()) {
      localStorage.removeItem('gl_token')
      setToken(null)
      return
    }
    setRole(p.role as string)
    setEmail(p.email as string)
  }, [token])

  const login = useCallback(async (email: string, password: string) => {
    const res: TokenOut = await apiLogin(email, password)
    localStorage.setItem('gl_token', res.access_token)
    setToken(res.access_token)
    const p = parseJwt(res.access_token)
    setRole(p.role as string)
    setEmail(p.email as string)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('gl_token')
    setToken(null)
    setRole(null)
    setEmail(null)
  }, [])

  return (
    <Ctx.Provider value={{ token, role, email, isAuthed: !!token, login, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
