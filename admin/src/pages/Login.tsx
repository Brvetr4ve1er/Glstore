import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/lib/auth'
import { Button, Input } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      await login(email, password)
      toast.success('Welcome back')
      navigate('/', { replace: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Login failed'
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--color-surface-0)] relative overflow-hidden">
      {/* Ambient scene */}
      <div className="absolute inset-0 pointer-events-none">
        {/* electric-blue glow */}
        <div className="absolute top-1/4 left-1/3 w-[480px] h-[260px] bg-[var(--color-electric-blue)] opacity-[0.06] blur-[120px] rounded-full" />
        {/* hot-pink glow */}
        <div className="absolute bottom-1/4 right-1/4 w-[360px] h-[220px] bg-[var(--color-hot-pink)] opacity-[0.05] blur-[120px] rounded-full" />
        {/* yellow glow */}
        <div className="absolute top-1/2 left-1/2 w-[600px] h-[200px] bg-[var(--color-neon-yellow)] opacity-[0.03] blur-[140px] rounded-full -translate-x-1/2 -translate-y-1/2" />

        {/* speed lines (decorative) */}
        <svg className="absolute top-10 left-10 opacity-20" width="120" height="60" viewBox="0 0 120 60" fill="none">
          <line x1="0"  y1="10" x2="100" y2="10" stroke="#FFD400" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="30" x2="110" y2="30" stroke="#FFD400" strokeWidth="2" strokeLinecap="round" />
          <line x1="10" y1="50" x2="80"  y2="50" stroke="#FFD400" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <motion.div
        className="glass w-full max-w-sm mx-4 relative"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        {/* brand stripe top */}
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-gradient-to-r from-[var(--color-electric-blue)] via-[var(--color-neon-yellow)] to-[var(--color-hot-pink)]" />

        {/* Header */}
        <div className="px-8 pt-9 pb-6 flex flex-col items-center gap-4 border-b border-[var(--color-surface-4)]">
          <BrandLogo size={56} showWordmark={false} />
          <div className="text-center flex flex-col gap-1">
            <div className="headline-italic text-xl text-[var(--color-text-1)]">
              <span className="text-[var(--color-electric-blue)]">GHiR</span>{' '}
              <span>LAFFAiRE</span>
            </div>
            <div className="text-[10px] tracking-[0.25em] uppercase text-[var(--color-neon-yellow)] font-bold">
              Fast · Reliable · Yours
            </div>
            <div className="text-xs text-[var(--color-text-3)] mt-2">
              Admin console — sign in to continue
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-6 flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            placeholder="admin@ghirlaffaire.dz"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="h-10 w-full pl-3 pr-10 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)] text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] hover:text-[var(--color-electric-blue)]"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {err && (
            <motion.p
              className="text-xs text-[var(--color-hot-pink)] bg-[var(--color-hot-pink)]/10 px-3 py-2 rounded-lg border border-[var(--color-hot-pink)]/25 font-medium"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
            >
              {err}
            </motion.p>
          )}

          <Button type="submit" loading={loading} variant="accent" size="lg" className="mt-1 w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="px-8 pb-6 text-center">
          <p className="text-[10px] text-[var(--color-text-3)] tracking-wide">
            Inspired by Shibuya punk · Built for Algeria
          </p>
        </div>
      </motion.div>
    </div>
  )
}
