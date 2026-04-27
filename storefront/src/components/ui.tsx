/* Storefront UI primitives — Button, Input, Select, Tag, Spinner, EmptyState, Card */
import { type ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/format'
import type { TagTone } from '@/lib/tags'

// ── Button ────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'accent' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] active:scale-[0.97] select-none cursor-pointer tracking-wide'
    const variants = {
      primary: 'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110 shadow-[0_0_22px_var(--color-brand-glow)]',
      accent:  'bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] hover:brightness-105 shadow-[0_0_22px_var(--color-accent-glow)]',
      ghost:   'text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-1)]',
      outline: 'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5',
      danger:  'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border border-[var(--color-hot-pink)]/35 hover:bg-[var(--color-hot-pink)]/25',
    }
    const sizes = {
      sm: 'text-xs px-3 py-1.5',
      md: 'text-sm px-4 py-2.5',
      lg: 'text-base px-6 py-3',
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
    <svg width={size} height={size} viewBox="0 0 24 24"
      className={cn('animate-spin text-current', className)} fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" strokeDasharray="40 20" />
    </svg>
  )
}

// ── Input ─────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, rightIcon, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            'h-11 w-full rounded-xl bg-[var(--color-surface-3)] border text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] transition-colors outline-none',
            leftIcon ? 'pl-10' : 'pl-3.5',
            rightIcon ? 'pr-10' : 'pr-3.5',
            error
              ? 'border-[var(--color-hot-pink)]/60 focus:border-[var(--color-hot-pink)]'
              : 'border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)]',
            className,
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]">
            {rightIcon}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-[var(--color-hot-pink)]">{error}</p>}
      {!error && hint && <p className="text-xs text-[var(--color-text-3)]">{hint}</p>}
    </div>
  ),
)
Input.displayName = 'Input'

// ── Select ────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, children, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[10px] font-bold text-[var(--color-text-2)] uppercase tracking-[0.18em]">
          {label}
        </label>
      )}
      <select
        ref={ref}
        className={cn(
          'h-11 px-3.5 rounded-xl bg-[var(--color-surface-3)] border text-sm text-[var(--color-text-1)] transition-colors outline-none cursor-pointer',
          error
            ? 'border-[var(--color-hot-pink)]/60 focus:border-[var(--color-hot-pink)]'
            : 'border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-[var(--color-hot-pink)]">{error}</p>}
    </div>
  ),
)
Select.displayName = 'Select'

// ── Textarea ───────────────────────────────────────────────────
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
          'min-h-[88px] px-3.5 py-3 rounded-xl bg-[var(--color-surface-3)] border text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] transition-colors resize-y outline-none',
          error
            ? 'border-[var(--color-hot-pink)]/60 focus:border-[var(--color-hot-pink)]'
            : 'border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)]',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-[var(--color-hot-pink)]">{error}</p>}
    </div>
  ),
)
Textarea.displayName = 'Textarea'

// ── Tag chip ─────────────────────────────────────────────────
export function Tag({ label, tone = 'muted' }: { label: string; tone?: TagTone }) {
  const tones: Record<TagTone, string> = {
    electric: 'bg-[var(--color-electric-blue)]/12 text-[var(--color-electric-blue)] border border-[var(--color-electric-blue)]/30',
    yellow:   'bg-[var(--color-neon-yellow)]/15 text-[var(--color-neon-yellow)] border border-[var(--color-neon-yellow)]/35',
    pink:     'bg-[var(--color-hot-pink)]/15 text-[var(--color-hot-pink)] border border-[var(--color-hot-pink)]/30',
    success:  'bg-emerald-500/12 text-emerald-400 border border-emerald-500/25',
    muted:    'bg-[var(--color-surface-3)] text-[var(--color-text-2)] border border-[var(--color-surface-4)]',
  }
  return (
    <span className={cn('badge', tones[tone])}>
      {label}
    </span>
  )
}

// ── EmptyState ────────────────────────────────────────────────
export function EmptyState({
  title, desc, action, icon,
}: {
  title: string; desc?: string; action?: ReactNode; icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      {icon ?? <div className="text-5xl opacity-30">◇</div>}
      <p className="text-base font-bold text-[var(--color-text-1)]">{title}</p>
      {desc && <p className="text-sm text-[var(--color-text-3)] max-w-md leading-relaxed">{desc}</p>}
      {action}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass p-6', className)}>{children}</div>
}
