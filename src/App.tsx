import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastBar } from './components/ToastBar'
import { Tour } from './components/Tour'
import { db } from './db/db'
import { savePendingAnswers } from './db/repo'
import { useSettings } from './hooks'
import { useApplyBackground } from './lib/background'
import { clearPendingAnswers, finishOnboarding, landingSeen, readStartParam, useOnboarding } from './lib/onboarding'
import { startTour, useTour } from './lib/tour'
import { useNotificationSync } from './push/useNotificationSync'
import { useSyncRunner } from './sync/useSyncRunner'
import { syncConfigured, useSession } from './sync/supabase'
import { LoginScreen, NewPasswordScreen } from './sync/LoginForm'
import { useRecovery } from './sync/recovery'
import { ShopModePage } from './pages/ShopMode'
import { Onboarding } from './pages/Onboarding'
import { MenuPage, PantryPage, ShoppingPage } from './pages/Pages'
import { ScanFoodPage } from './pages/ScanFood'
import { SettingsPage } from './pages/Settings'

// Presentationssidan leder hit med ?start=: läses en gång, innan något visas.
const START = readStartParam()
// "Logga in" på presentationssidan: frågorna hoppas över, inloggningen visas direkt.
if (START === 'logga-in') {
  try {
    if (!JSON.parse(localStorage.getItem('matplanerare-onboarding') ?? 'null')?.done) finishOnboarding(null)
  } catch {
    finishOnboarding(null)
  }
}

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
  // En ny besökare får först se vad appen är: presentationssidan, som leder tillbaka hit.
  const toLanding = asking && !START && !landingSeen()
  useEffect(() => {
    if (toLanding) window.location.replace('/om/')
  }, [toLanding])
  // Den som redan använder appen och tryckte Kom igång på presentationssidan ska inte få
  // sina inställningar ändrade av valen där: de gäller bara nya.
  const startChecked = useRef(false)
  useEffect(() => {
    if (loading || startChecked.current) return
    startChecked.current = true
    if (START === 'fragor' && !asking) clearPendingAnswers()
  }, [loading, asking])
  // Första gången man kommer in i appen visas en rundtur som lyser upp det viktigaste.
  // Den som kommit in via länken i mejlet om glömt lösenord väljer först ett nytt lösenord.
  const recovery = useRecovery()
  const recovering = !loading && Boolean(session) && (recovery.active || recovery.pending)
  const tour = useTour()
  const inApp = !loading && !asking && !loggedOut && !recovering
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
        {loading || toLanding ? (
          <p className="loading" role="status" aria-busy="true">Laddar…</p>
        ) : recovering ? (
          <NewPasswordScreen email={session?.user.email} />
        ) : asking ? (
          // Utan konto finns inget att vänta på: svaren sparas direkt.
          <Onboarding defaultPortions={settings!.food.portions} hasAccounts={syncConfigured} startAt={START === 'fragor' ? 1 : undefined} onDone={() => { if (!syncConfigured) void savePendingAnswers() }} />
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
      {(!syncConfigured || session) && !asking && !recovering && <Nav />}
    </BrowserRouter>
  )
}
