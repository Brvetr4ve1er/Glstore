/**
 * Step 1 — what the shopper is asking to finance, exactly as the server
 * priced it when the application was opened. Every figure is the API's
 * decimal string, shown with the server's own caption (<EstimateLabel>).
 */
import type { ReactNode } from 'react'
import { ArrowRight, Package } from 'lucide-react'
import type { ApplicationDetail } from '@/lib/api'
import { cn, fmtAmount } from '@/lib/format'
import { Button } from '@/components/ui'
import { EstimateLabel } from '@/components/financing/EstimateLabel'

export function StepSummary({
  application, onNext,
}: { application: ApplicationDetail; onNext: () => void }) {
  const items = application.items

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-[var(--color-text-1)]">Récapitulatif</h2>
        <p className="text-sm text-[var(--color-text-3)] mt-1 leading-relaxed">
          Vérifiez les articles et les montants de votre demande avant de continuer.
        </p>
      </div>

      <section aria-labelledby="apply-summary-items" className="glass p-5 sm:p-6">
        <h3
          id="apply-summary-items"
          className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-3 flex items-center gap-2"
        >
          <Package size={13} aria-hidden="true" /> Articles ({items.length})
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-3)]">Aucun article n'est rattaché à cette demande.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map(it => (
              <li
                key={`${it.offer_id}-${it.variant_sku}`}
                className="glass-sm flex items-center justify-between px-3 py-2.5 gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--color-text-1)] font-semibold break-words">
                    {it.product_name}
                  </div>
                  <div className="text-[11px] num text-[var(--color-text-3)]">
                    {it.variant_sku} · ×{it.quantity}
                  </div>
                </div>
                <div className="num font-bold text-[var(--color-text-1)] shrink-0 text-right">
                  {it.line_total != null
                    ? fmtAmount(it.line_total)
                    : <>{it.quantity} × {fmtAmount(it.unit_price)}</>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="apply-summary-amounts" className="glass-strong p-5 sm:p-6 relative overflow-hidden">
        <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
        <h3
          id="apply-summary-amounts"
          className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-3)] mb-4"
        >
          Montants
        </h3>
        <dl className="flex flex-col divide-y divide-[var(--color-surface-4)]">
          <Figure label="Prix comptant total" value={fmtAmount(application.cash_total)} />
          <Figure label="Apport initial" value={fmtAmount(application.down_payment)} />
          <Figure label="Montant financé" value={fmtAmount(application.financed_amount)} />
          <Figure label="Total à rembourser" value={fmtAmount(application.total_repayable)} strong />
          <Figure
            label="Remboursement mensuel estimé"
            value={
              <>
                {fmtAmount(application.monthly_instalment)}
                <span className="text-sm font-bold text-[var(--color-text-2)]">
                  {' '}× {application.duration_months} mois
                </span>
              </>
            }
            strong
          />
        </dl>
        <EstimateLabel presentation={application} className="mt-4" />
      </section>

      <div className="flex justify-end">
        <Button type="button" variant="accent" size="lg" onClick={onNext} className="w-full sm:w-auto">
          Continuer <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function Figure({
  label, value, strong,
}: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-[var(--color-text-2)]">{label}</dt>
      <dd
        className={cn(
          'num font-black text-right',
          strong ? 'text-xl text-[var(--color-text-1)]' : 'text-base text-[var(--color-text-1)]',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
