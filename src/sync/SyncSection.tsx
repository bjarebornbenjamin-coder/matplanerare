import { LoginForm } from './LoginForm'
import { useSyncStatus } from './status'
import { supabase, syncConfigured, useSession } from './supabase'

export function SyncSection() {
  const session = useSession()
  const status = useSyncStatus()
  if (!syncConfigured || !supabase) {
    return (
      <>
        <p className="muted">Synk är inte påslagen på den här installationen. Se README (avsnittet Supabase) för hur du kopplar den.</p>
      </>
    )
  }
  const client = supabase
  if (session === undefined) return null

  return (
    <>
      {session ? (
        <>
          <p>Inloggad som {session.user.email}.</p>
          <p className="muted" role="status">
            {status.state === 'syncing' && 'Synkar…'}
            {status.state === 'idle' && `Senast synkad ${status.lastSync ? new Date(status.lastSync).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : ''}.`}
            {status.state === 'error' && <span className="error">Synken misslyckades: {status.error}</span>}
            {!navigator.onLine && ' Du är offline. Ändringar synkas när nätet är tillbaka.'}
          </p>
          <div className="actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('manual-sync'))}>Synka nu</button>
            <button type="button" className="btn danger" onClick={() => client.auth.signOut()}>Logga ut</button>
          </div>
          <p className="muted">Datan finns kvar på enheten när du loggar ut, men synkas inte längre.</p>
        </>
      ) : (
        <LoginForm intro="Logga in så följer meny, matlager och inköpslista med mellan dina enheter. Din befintliga data på den här enheten laddas upp första gången." />
      )}
    </>
  )
}
