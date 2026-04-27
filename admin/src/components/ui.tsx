/* Unified UI primitives — Ghir Laffaire brand
 * Button · Badge · Input · Select · Spinner · Modal · EmptyState · Card · StatCard · PageHeader
 */
import { type ReactNode, forwardRef, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

// ── Button ────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'accent' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 font-bold rounded-lg transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] active:scale-[0.97] select-none cursor-pointer tracking-wide'
    const variants = {
      // Bold blue → electric on hover (trust → speed)
      primary:
        'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110 shadow-[0_0_18px_var(--color-brand-glow)]',
      // Yellow CTA — high-attention "win" button
      accent:
        'bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_18px_var(--color-accent-glow)]',
      ghost:
        'text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-1)]',
      // Hot pink — punk danger
      danger:
        'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border border-[var(--color-hot-pink)]/35 hover:bg-[var(--color-hot-pink)]/25',
      outline:
        'border border-[var(--color-surface-4)] text-[var(--color-text-2)] hover:border-[var(--color-electric-blue)] hover:text-[var(--color-text-1)]',
    }
    const sizes = {
      sm: 'text-xs px-3 py-1.5',
      md: 'text-sm px-4 py-2',
      lg: 'text-base px-6 py-2.5',
    }
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], (disabled || loading) && 'opacity-50 cursor-not-allowed', className)}
        {...props}
      >
        {loading && <Spinner size={14} />}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      className={cn('animate-spin text-current', className)}
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
        strokeDasharray="40 20" />
    </svg>
  )
}

// ── Badge ─────────────────────────────────────────────────────
export function Badge({ label, colorClass }: { label: string; colorClass?: string }) {
  return (
    <span className={cn('badge', colorClass ?? 'bg-[var(--color-surface-3)] text-[var(--color-text-2)] border border-[var(--color-surface-4)]')}>
      {label}
    </span>
  )
}

// ── Input ─────────────────────────────────────────────────────
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }>(
  ({ label, error, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
          {label}
        </label>
      )}
      <input
        ref={ref}
        className={cn(
          'h-10 px-3 rounded-lg bg-[var(--color-surface-3)] border text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] transition-colors',
          error
            ? 'border-[var(--color-hot-pink)]/60 focus:border-[var(--color-hot-pink)]'
            : 'border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)]',
          'outline-none',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-[var(--color-hot-pink)]">{error}</p>}
    </div>
  ),
)
Input.displayName = 'Input'

// ── Textarea ──────────────────────────────────────────────────
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }>(
  ({ label, error, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={cn(
          'min-h-[88px] px-3 py-2.5 rounded-lg bg-[var(--color-surface-3)] border text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] transition-colors resize-y',
          error
            ? 'border-[var(--color-hot-pink)]/60 focus:border-[var(--color-hot-pink)]'
            : 'border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)]',
          'outline-none',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-[var(--color-hot-pink)]">{error}</p>}
    </div>
  ),
)
Textarea.displayName = 'Textarea'

// ── Select ────────────────────────────────────────────────────
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }>(
  ({ label, className, children, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
          {label}
        </label>
      )}
      <select
        ref={ref}
        className={cn(
          'h-10 px-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-surface-4)] text-sm text-[var(--color-text-1)] transition-colors focus:border-[var(--color-electric-blue)] outline-none cursor-pointer',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  ),
)
Select.displayName = 'Select'

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass p-5', className)}>{children}</div>
}

// ── StatCard ──────────────────────────────────────────────────
export function StatCard({
  label, value, sub, icon, loading, accent = 'var(--color-electric-blue)',
}: {
  label: string; value: string | number; sub?: string
  icon?: ReactNode; loading?: boolean; accent?: string
}) {
  return (
    <motion.div
      className="glass p-5 flex flex-col gap-3 relative overflow-hidden"
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
    >
      {/* corner accent */}
      <div
        className="absolute top-0 right-0 w-24 h-24 opacity-[0.10] pointer-events-none rounded-full blur-2xl"
        style={{ background: accent }}
      />
      {/* corner stripe */}
      <div
        className="absolute top-0 left-0 w-1 h-full"
        style={{ background: accent }}
      />

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-[var(--color-text-3)] uppercase tracking-[0.18em]">
          {label}
        </span>
        {icon && (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${accent}22`, color: accent }}>
            {icon}
          </span>
        )}
      </div>

      {loading
        ? <div className="shimmer h-8 w-28 rounded" />
        : (
          <motion.div
            key={String(value)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="text-3xl font-black num text-[var(--color-text-1)]"
          >
            {value}
          </motion.div>
        )}

      {sub && <div className="text-xs text-[var(--color-text-3)]">{sub}</div>}
    </motion.div>
  )
}

// ── Modal ─────────────────────────────────────────────────────
export function Modal({
  open, onClose, title, children, maxWidth = 'max-w-lg',
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; maxWidth?: string
}) {
  return (
    <AnimatePresence>
      {open && (
        <Fragment>
          <motion.div
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className={cn('fixed inset-0 z-50 flex items-center justify-center p-4')}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className={cn('glass w-full flex flex-col max-h-[90vh] relative', maxWidth)}
              initial={{ scale: 0.94, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-gradient-to-r from-[var(--color-electric-blue)] via-[var(--color-neon-yellow)] to-[var(--color-hot-pink)]" />
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-surface-4)]">
                <h2 className="text-base font-bold text-[var(--color-text-1)]">{title}</h2>
                <button onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-[var(--color-surface-3)] text-[var(--color-text-3)] hover:text-[var(--color-hot-pink)] transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
            </motion.div>
          </motion.div>
        </Fragment>
      )}
    </AnimatePresence>
  )
}

// ── EmptyState ────────────────────────────────────────────────
export function EmptyState({ title, desc, action, icon }: { title: string; desc?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      {icon ?? <div className="text-5xl opacity-25">◇</div>}
      <p className="text-[var(--color-text-1)] font-bold tracking-wide">{title}</p>
      {desc && <p className="text-xs text-[var(--color-text-3)] max-w-xs leading-relaxed">{desc}</p>}
      {action}
    </div>
  )
}

// ── PageHeader ────────────────────────────────────────────────
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-[var(--color-text-1)] flex items-center gap-3">
          <span className="punk-stripe">{title}</span>
        </h1>
        {sub && <p className="text-xs text-[var(--color-text-3)] mt-1.5 tracking-wide">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
