/**
 * The compact account band on Home.
 *
 * Signed out → a sign-in link that comes back to /account (through loginPath,
 * so the login page's safeNext() handles the return). Signed in → "Mon compte".
 * While a stored session token is still being checked, the CTA slot holds a
 * same-size placeholder so the band does not jump from one state to the other.
 *
 * Factual only: /account/orders lists the orders placed with the verified
 * phone (api/routes/customer_account.py matches by phone, not by session), and
 * sign-in is a code sent by SMS. The phone itself is not shown here — the home
 * page may be on a shared screen; AccountShell shows it inside the account.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, LogIn, UserRound } from 'lucide-react'
import { cn } from '@/lib/format'
import { loginPath, useCustomer } from '@/lib/session'

const TITLE_ID = 'home-account-title'

const CTA =
  'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-150 tracking-wide text-sm px-4 py-2.5 select-none whitespace-nowrap active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--color-electric-blue)]'
const PRIMARY =
  'bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] hover:brightness-110 shadow-[0_0_22px_var(--color-brand-glow)]'
const OUTLINE =
  'border border-[var(--color-surface-4)] text-[var(--color-text-1)] hover:border-[var(--color-electric-blue)] hover:bg-[var(--color-electric-blue)]/5'

export function HomeAccountBand() {
  const { signedIn, loading } = useCustomer()

  return (
    <section aria-labelledby={TITLE_ID} className="max-w-[1400px] mx-auto px-6 mb-16">
      <div className="glass-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex items-start sm:items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-[var(--color-neon-yellow)]/15 flex items-center justify-center shrink-0">
            <UserRound size={18} aria-hidden="true" className="text-[var(--color-neon-yellow)]" />
          </span>
          <div>
            <h2 id={TITLE_ID} className="text-base font-black text-[var(--color-text-1)]">
              Suivez vos commandes et vos demandes
            </h2>
            <p className="text-xs text-[var(--color-text-3)] mt-0.5 leading-relaxed">
              {signedIn
                ? 'Vos commandes et vos demandes sont regroupées dans votre compte.'
                : 'Connectez-vous avec le numéro de téléphone utilisé pour vos commandes, grâce à un code reçu par SMS.'}
            </p>
          </div>
        </div>

        {loading ? (
          <div
            role="status"
            className="h-10 w-40 rounded-xl shimmer shrink-0"
          >
            {/* A live region needs text content to be announced. */}
            <span className="sr-only">Vérification de la session…</span>
          </div>
        ) : signedIn ? (
          <Link to="/account" className={cn(CTA, OUTLINE, 'self-start sm:self-auto')}>
            Mon compte <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <Link to={loginPath('/account')} className={cn(CTA, PRIMARY, 'self-start sm:self-auto')}>
            <LogIn size={16} aria-hidden="true" /> Se connecter
          </Link>
        )}
      </div>
    </section>
  )
}
