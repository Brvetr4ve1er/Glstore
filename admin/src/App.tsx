import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import AOS from 'aos'
import 'aos/dist/aos.css'
import { queryClient } from '@/lib/query'
import { AuthProvider, useAuth } from '@/lib/auth'
import { StoreProvider } from '@/lib/store'
import Layout from '@/components/Layout'
import { Spinner } from '@/components/ui'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { fetchTheme } from '@/lib/api'
import { applyTheme, bindCrossTabSync } from '@/lib/theme'

// Lazy pages
const Login        = lazy(() => import('@/pages/Login'))
const Dashboard    = lazy(() => import('@/pages/Dashboard'))
const Products     = lazy(() => import('@/pages/Products'))
const ProductDetail= lazy(() => import('@/pages/ProductDetail'))
const ProductEditor= lazy(() => import('@/pages/ProductEditor'))
const ProductImport= lazy(() => import('@/pages/ProductImport'))
const IssueExplorer= lazy(() => import('@/pages/IssueExplorer'))
const Settings    = lazy(() => import('@/pages/Settings'))
const JobsConsole = lazy(() => import('@/pages/JobsConsole'))
const CatalogGraph= lazy(() => import('@/pages/CatalogGraph'))
const Orders       = lazy(() => import('@/pages/Orders'))
const OrderDetail  = lazy(() => import('@/pages/OrderDetail'))
const ProductImageReview = lazy(() => import('@/pages/ImageReview'))
const GlobalImageQueue   = lazy(() => import('@/pages/ImageReview').then(m => ({ default: m.GlobalImageQueue })))
const ThemeStudio        = lazy(() => import('@/pages/ThemeStudio'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthed } = useAuth()
  return isAuthed ? <>{children}</> : <Navigate to="/login" replace />
}

function AppRoutes() {
  const location = useLocation()
  const { isAuthed } = useAuth()

  // Refresh theme from server once we have a valid session. We've already
  // painted with the cached theme via main.tsx; this just brings an authoritative
  // copy home so a different admin or device sees the latest.
  useEffect(() => {
    if (!isAuthed) return
    let cancelled = false
    fetchTheme('admin')
      .then(t => { if (!cancelled) applyTheme(t, 'admin') })
      .catch(() => { /* noop — keep cached */ })
    return () => { cancelled = true }
  }, [isAuthed])

  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={
        <div className="min-h-dvh flex items-center justify-center">
          <Spinner size={28} className="text-[var(--color-brand)]" />
        </div>
      }>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><StoreProvider><Layout /></StoreProvider></RequireAuth>}>
            <Route index        element={<Dashboard />} />
            <Route path="products"            element={<Products />} />
            <Route path="products/new"        element={<ProductEditor />} />
            <Route path="products/import"     element={<ProductImport />} />
            <Route path="products/issues"     element={<IssueExplorer />} />
            <Route path="products/:id"        element={<ProductDetail />} />
            <Route path="products/:id/edit"   element={<ProductEditor />} />
            <Route path="products/:id/images" element={<ProductImageReview />} />
            <Route path="images"          element={<GlobalImageQueue />} />
            <Route path="orders"          element={<Orders />} />
            <Route path="orders/:id"      element={<OrderDetail />} />
            <Route path="jobs"            element={<JobsConsole />} />
            <Route path="graph"           element={<CatalogGraph />} />
            <Route path="settings"        element={<Settings />} />
            <Route path="settings/theme"  element={<ThemeStudio />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  useEffect(() => {
    AOS.init({
      duration: 400,
      easing: 'ease-out-cubic',
      once: true,
      offset: 20,
    })
    // Cross-tab theme sync: when another admin tab saves a new theme,
    // mirror it here too so the active preset stays consistent.
    return bindCrossTabSync()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-surface-2)',
              color: 'var(--color-text-1)',
              border: '1px solid var(--color-surface-4)',
              borderRadius: '12px',
              fontSize: '13px',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: 'white' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: 'white' } },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  )
}
