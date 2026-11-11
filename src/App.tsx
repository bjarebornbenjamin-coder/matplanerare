import { useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastBar } from './components/ToastBar'
import { useSettings } from './hooks'
import { useApplyBackground } from './lib/background'
import { useNotificationSync } from './push/useNotificationSync'
import { useSyncRunner } from './sync/useSyncRunner'
import { syncConfigured, useSession } from './sync/supabase'
import { LoginScreen } from './sync/LoginForm'
import { MenuPage, PantryPage, ShoppingPage } from './pages/Pages'
import { ScanFoodPage } from './pages/ScanFood'
import { SettingsPage } from './pages/Settings'

/** Undersidor som hör till en flik markerar den fliken i menyn. */
const TABS = [
  { to: '/', label: 'Meny', also: ['/installningar'] as string[] },
  { to: '/lager', label: 'Lager', also: ['/skanna'] },
  { to: '/inkop', label: 'Inköp', also: [] },
]

/** Varje ny sida börjar högst upp (annars följer scrollpositionen med mellan flikar). */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function Nav() {
  const { pathname } = useLocation()
  return (
    <nav className="nav" aria-label="Huvudmeny">
      {TABS.map((t) => {
        const active = [t.to, ...t.also].some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))
        return (
          <Link key={t.to} to={t.to} aria-current={active ? 'page' : undefined}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function App() {
  useSyncRunner()
  useApplyBackground()
  useNotificationSync()
  const settings = useSettings()
  const session = useSession()
  const theme = settings?.theme

  useEffect(() => {
    const root = document.documentElement
    if (!theme || theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])

  return (
    <BrowserRouter>
      <ScrollToTop />
      <main className="shell">
        {!settings || session === undefined ? (
          <p className="loading" role="status" aria-busy="true">Laddar…</p>
        ) : syncConfigured && !session ? (
          <LoginScreen />
        ) : (
          <Routes>
            <Route path="/" element={<MenuPage />} />
            <Route path="/lager" element={<PantryPage />} />
            <Route path="/inkop" element={<ShoppingPage />} />
            <Route path="/skanna" element={<ScanFoodPage />} />
            <Route path="/installningar" element={<SettingsPage />} />
            <Route path="/installningar/:del" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <ToastBar />
      {(!syncConfigured || session) && <Nav />}
    </BrowserRouter>
  )
}
