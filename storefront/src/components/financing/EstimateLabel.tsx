/**
 * The caption every financing figure carries — and the only place it comes from.
 *
 * The text is the server's `label` (FINANCING_TERMS_PUBLIC decides it), never
 * hand-written: while terms are not public it reads as an estimate subject to
 * acceptance. A page that shows a monthly figure without this component is a
 * credit offer the operator has not approved; src/__tests__/credit-copy.test.ts
 * fails any page that renders `monthly_instalment` without importing it.
 */
import { Info } from 'lucide-react'
import type { FinancingPresentation } from '@/lib/api'
import { cn } from '@/lib/format'

export function EstimateLabel({
  presentation, className,
}: { presentation: FinancingPresentation; className?: string }) {
  const estimate = presentation.kind === 'ESTIMATE'
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 text-xs leading-relaxed rounded-lg px-3 py-2 border',
        estimate
          ? 'bg-[var(--color-neon-yellow)]/10 border-[var(--color-neon-yellow)]/40 text-[var(--color-text-1)]'
          : 'bg-[var(--color-surface-3)] border-[var(--color-surface-4)] text-[var(--color-text-2)]',
        className,
      )}
    >
      <Info size={14} aria-hidden="true" className="shrink-0 mt-0.5" />
      <span>{presentation.label}</span>
    </p>
  )
}
