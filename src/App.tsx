import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastBar } from './components/ToastBar'
import { Tour } from './components/Tour'
import { db } from './db/db'
import { savePendingAnswers } from './db/repo'
import { useSettings } from './hooks'
import { useApplyBackground } from './lib/background'
import { useOnboarding } from './lib/onboarding'
import { startTour, useTour } from './lib/tour'
import { useNotificationSync } from './push/useNotificationSync'
import { useSyncRunner } from './sync/useSyncRunner'
import { syncConfigured, useSession } from './sync/supabase'
import { LoginScreen } from './sync/LoginForm'
import { ShopModePage } from './pages/ShopMode'
import { Onboarding } from './pages/Onboarding'
import { MenuPage, PantryPage, ShoppingPage } from './pages/Pages'
import { ScanFoodPage } from './pages/ScanFood'
import { SettingsPage } from './pages/Settings'

/** Undersidor som hör till en flik markerar den fliken i menyn. */
const TABS = [
  { to: '/', label: 'Meny', also: ['/installningar'] as string[] },
  { to: '/lager', label: 'Lager', also: ['/skanna'] },
  { to: '/inkop', label: 'Inköp', also: ['/handla'] },
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
  const onboarding = useOnboarding()
  // Utan konto ställs frågorna bara på en helt ny installation, inte för den som redan använder appen.
  const hasSettings = useLiveQuery(async () => (await db.settings.count()) > 0, [])
  const loading = !settings || session === undefined || hasSettings === undefined
  const loggedOut = syncConfigured && !session
  // Frågorna om portioner, matpreferenser och allergier kommer före inloggningen.
  const asking = !loading && !onboarding.done && (loggedOut || (!syncConfigured && !hasSettings))
  // Första gången man kommer in i appen visas en rundtur som lyser upp det viktigaste.
  const tour = useTour()
  const inApp = !loading && !asking && !loggedOut
  useEffect(() => {
    if (inApp && !tour.done && !tour.active) startTour()
  }, [inApp, tour.done, tour.active])

  useEffect(() => {
    const root = document.documentElement
    if (!theme || theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])

  return (
    <BrowserRouter>
      <ScrollToTop />
      <main className="shell">
        {loading ? (
          <p className="loading" role="status" aria-busy="true">Laddar…</p>
        ) : asking ? (
          // Utan konto finns inget att vänta på: svaren sparas direkt.
          <Onboarding defaultPortions={settings.food.portions} hasAccounts={syncConfigured} onDone={() => { if (!syncConfigured) void savePendingAnswers() }} />
        ) : loggedOut ? (
          <LoginScreen />
        ) : (
          <Routes>
            <Route path="/" element={<MenuPage />} />
            <Route path="/lager" element={<PantryPage />} />
            <Route path="/inkop" element={<ShoppingPage />} />
            <Route path="/handla" element={<><ShoppingPage /><ShopModePage /></>} />
            <Route path="/skanna" element={<ScanFoodPage />} />
            <Route path="/installningar" element={<SettingsPage />} />
            <Route path="/installningar/:del" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <ToastBar />
      {inApp && tour.active && <Tour />}
      {(!syncConfigured || session) && !asking && <Nav />}
    </BrowserRouter>
  )
}
