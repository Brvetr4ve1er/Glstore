/**
 * NewsletterForm — self-contained email signup.
 *
 * `POST /newsletter` is idempotent: the API returns the same success shape
 * whether the address is new or already subscribed (see project brief), so
 * this component never tries to distinguish "welcome" from "already on the
 * list" copy — it has no field to source that distinction from.
 *
 * Success/error text is fixed, French copy owned by this component rather
 * than the raw API response message: the brief requires French-only
 * user-facing strings, and nothing guarantees the backend message field is
 * French, so it is never rendered directly.
 *
 * Owned exclusively by this file per the brief — Footer.tsx is wired to it by
 * the orchestrator after this lands, not here.
 */
import { useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { subscribeNewsletter } from '@/lib/api'
import { cn } from '@/lib/format'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function NewsletterForm({ className }: { className?: string }) {
  const inputId = useId()
  const statusId = `${inputId}-status`

  const [email, setEmail] = useState('')
  const [formatError, setFormatError] = useState<string | null>(null)

  const mut = useMutation({ mutationFn: (addr: string) => subscribeNewsletter(addr) })

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setFormatError('Adresse e-mail invalide.')
      return
    }
    setFormatError(null)
    mut.mutate(trimmed, { onSuccess: () => setEmail('') })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value)
    if (formatError) setFormatError(null)
    if (mut.isSuccess || mut.isError) mut.reset()
  }

  const invalid = Boolean(formatError) || mut.isError
  const statusMessage = formatError
    ? formatError
    : mut.isError
      ? 'Une erreur est survenue. Veuillez réessayer.'
      : mut.isSuccess
        ? 'Inscription enregistrée. Merci !'
        : null

  return (
    <form onSubmit={handleSubmit} noValidate className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={inputId} className="sr-only">
        Adresse e-mail
      </label>
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1 min-w-0">
          <Mail
            size={15}
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)] pointer-events-none"
          />
          <input
            id={inputId}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="votre@email.com"
            value={email}
            onChange={handleChange}
            disabled={mut.isPending}
            aria-invalid={invalid || undefined}
            aria-describedby={statusMessage ? statusId : undefined}
            className={cn(
              'h-11 w-full rounded-xl bg-[var(--color-surface-3)] border pl-9 pr-3.5 text-sm text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] outline-none transition-colors disabled:opacity-60',
              invalid
                ? 'border-[var(--color-hot-pink)]/60 focus:border-[var(--color-hot-pink)]'
                : 'border-[var(--color-surface-4)] focus:border-[var(--color-electric-blue)]',
            )}
          />
        </div>
        <button
          type="submit"
          disabled={mut.isPending}
          aria-label={mut.isPending ? 'Inscription en cours' : undefined}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-electric-blue)] px-4 py-2.5 text-sm font-bold tracking-wide text-[var(--color-jet-black)] shadow-[0_0_22px_var(--color-brand-glow)] transition-all duration-150 select-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mut.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : "S'inscrire"}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {statusMessage && (
          <motion.p
            key={statusMessage}
            id={statusId}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'flex items-center gap-1.5 text-xs',
              mut.isSuccess ? 'text-emerald-400' : 'text-[var(--color-hot-pink)]',
            )}
          >
            {mut.isSuccess ? (
              <CheckCircle2 size={13} className="shrink-0" aria-hidden />
            ) : (
              <AlertCircle size={13} className="shrink-0" aria-hidden />
            )}
            {statusMessage}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  )
}
