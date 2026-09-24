import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { MotionConfig } from 'framer-motion'

import { queryClient } from '@/lib/query'
import { CartProvider } from '@/lib/cart'
import { CustomerProvider, RequireCustomer } from '@/lib/session'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { Spinner } from '@/components/ui'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const Home              = lazy(() => import('@/pages/Home'))
const Catalog           = lazy(() => import('@/pages/Catalog'))
const SearchResults     = lazy(() => import('@/pages/SearchResults'))
const ProductDetailPage = lazy(() => import('@/pages/ProductDetail'))
const Cart              = lazy(() => import('@/pages/Cart'))
const Checkout          = lazy(() => import('@/pages/Checkout'))
const OrderConfirmation = lazy(() => import('@/pages/OrderConfirmation'))
const OrderTracking     = lazy(() => import('@/pages/OrderTracking'))
const Contact           = lazy(() => import('@/pages/Contact'))
const Faq                = lazy(() => import('@/pages/Faq'))
const NotFound          = lazy(() => import('@/pages/NotFound'))
const Login             = lazy(() => import('@/pages/account/Login'))
const Account           = lazy(() => import('@/pages/account/Account'))
const Orders            = lazy(() => import('@/pages/account/Orders'))
const OrderDetail       = lazy(() => import('@/pages/account/OrderDetail'))
const Applications      = lazy(() => import('@/pages/account/Applications'))
const ApplicationDetail = lazy(() => import('@/pages/account/ApplicationDetail'))
const Simulate          = lazy(() => import('@/pages/Simulate'))
const Financing         = lazy(() => import('@/pages/Financing'))
const Apply             = lazy(() => import('@/pages/apply/Apply'))


function PageFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Spinner size={28} className="text-[var(--color-electric-blue)]" />
    </div>
  )
}


/** Re-mounts the boundary on every route change so a crash on one page
 *  doesn't blank-screen subsequent navigations. */
function RoutedShell() {
  const location = useLocation()
  return (
    <>
      <Navbar />
      <main id="main" className="flex-1">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/"                          element={<Home />} />
              <Route path="/c/:category"               element={<Catalog />} />
              <Route path="/search"                    element={<SearchResults />} />
              <Route path="/p/:slug"                   element={<ProductDetailPage />} />
              <Route path="/cart"                      element={<Cart />} />
              <Route path="/checkout"                  element={<Checkout />} />
              <Route path="/order/confirmation/:id"    element={<OrderConfirmation />} />
              <Route path="/order/track"               element={<OrderTracking />} />
              <Route path="/contact"                   element={<Contact />} />
              <Route path="/faq"                       element={<Faq />} />
              <Route path="/login"                     element={<Login />} />
              <Route path="/simulate"                  element={<Simulate />} />
              <Route path="/financement"               element={<Financing />} />
              <Route path="/account"                   element={<RequireCustomer><Account /></RequireCustomer>} />
              <Route path="/account/orders"            element={<RequireCustomer><Orders /></RequireCustomer>} />
              <Route path="/account/orders/:id"        element={<RequireCustomer><OrderDetail /></RequireCustomer>} />
              <Route path="/account/applications"      element={<RequireCustomer><Applications /></RequireCustomer>} />
              <Route path="/account/applications/:id"  element={<RequireCustomer><ApplicationDetail /></RequireCustomer>} />
              <Route path="/apply/:id"                 element={<RequireCustomer><Apply /></RequireCustomer>} />
              <Route path="*"                          element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </>
  )
}


export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CustomerProvider>
      <CartProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <div className="flex flex-col min-h-dvh">
              {/* Top-level boundary catches anything outside the routed shell
                  (Navbar/Footer crashes, etc.) */}
              <ErrorBoundary>
                <RoutedShell />
              </ErrorBoundary>
            </div>
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
                padding: '10px 14px',
              },
              success: { iconTheme: { primary: '#22c55e', secondary: '#0a0a0d' } },
              error:   { iconTheme: { primary: '#FF2E7A', secondary: '#0a0a0d' } },
            }}
          />
        </MotionConfig>
      </CartProvider>
      </CustomerProvider>
    </QueryClientProvider>
  )
}
