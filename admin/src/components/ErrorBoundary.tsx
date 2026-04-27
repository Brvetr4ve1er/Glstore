import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional reset key — when this prop changes, the boundary clears its error. */
  resetKey?: string | number
}

interface State {
  error: Error | null
  errorInfo: { componentStack?: string } | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    this.setState({ errorInfo: info })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, errorInfo: null })
    }
  }

  render() {
    const { error, errorInfo } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="glass-strong p-8 max-w-lg w-full relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-electric-blue)] via-[var(--color-neon-yellow)] to-[var(--color-hot-pink)]" />
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--color-hot-pink)]/15 flex items-center justify-center shrink-0">
              <AlertTriangle size={22} className="text-[var(--color-hot-pink)]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-black text-[var(--color-text-1)] mb-1">
                Quelque chose a planté
              </h2>
              <p className="text-sm text-[var(--color-text-3)] leading-relaxed">
                Une partie de l’interface a échoué. Le reste de l’application fonctionne. Vous pouvez recharger cette page ou retourner au tableau de bord.
              </p>

              <details className="mt-4 text-xs text-[var(--color-text-3)] font-mono">
                <summary className="cursor-pointer hover:text-[var(--color-text-2)]">Détails techniques</summary>
                <pre className="mt-2 p-3 bg-[var(--color-surface-3)] rounded-lg overflow-auto max-h-48 whitespace-pre-wrap break-words">
                  {error.name}: {error.message}
                  {errorInfo?.componentStack && '\n\n' + errorInfo.componentStack}
                </pre>
              </details>

              <div className="flex gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-electric-blue)] text-[var(--color-jet-black)] text-sm font-bold hover:brightness-110 transition-all"
                >
                  <RotateCcw size={14} /> Recharger
                </button>
                <button
                  type="button"
                  onClick={() => this.setState({ error: null, errorInfo: null })}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-surface-4)] text-[var(--color-text-2)] text-sm font-bold hover:border-[var(--color-electric-blue)] hover:text-[var(--color-text-1)] transition-all"
                >
                  Réessayer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
