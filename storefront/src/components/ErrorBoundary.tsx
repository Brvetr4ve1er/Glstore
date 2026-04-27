import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Props {
  children: ReactNode
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
          <div className="absolute top-0 left-0 right-0 h-1 brand-stripe" />
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--color-hot-pink)]/15 flex items-center justify-center shrink-0">
              <AlertTriangle size={22} className="text-[var(--color-hot-pink)]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-black text-[var(--color-text-1)] mb-1 font-display">
                Oups, une erreur est survenue
              </h2>
              <p className="text-sm text-[var(--color-text-3)] leading-relaxed">
                Cette page n'a pas pu s'afficher correctement. Le reste du site fonctionne — vous pouvez retourner à l'accueil ou recharger.
              </p>

              <details className="mt-4 text-xs text-[var(--color-text-3)] font-mono">
                <summary className="cursor-pointer hover:text-[var(--color-text-2)]">
                  Détails techniques
                </summary>
                <pre className="mt-2 p-3 bg-[var(--color-surface-3)] rounded-lg overflow-auto max-h-48 whitespace-pre-wrap break-words">
                  {error.name}: {error.message}
                  {errorInfo?.componentStack && '\n\n' + errorInfo.componentStack}
                </pre>
              </details>

              <div className="flex gap-3 mt-5 flex-wrap">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-neon-yellow)] text-[var(--color-jet-black)] text-sm font-bold hover:brightness-105 transition-all"
                >
                  <RotateCcw size={14} /> Recharger
                </button>
                <Link
                  to="/"
                  onClick={() => this.setState({ error: null, errorInfo: null })}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--color-surface-4)] text-[var(--color-text-2)] text-sm font-bold hover:border-[var(--color-electric-blue)] hover:text-[var(--color-text-1)] transition-all"
                >
                  <Home size={14} /> Accueil
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
