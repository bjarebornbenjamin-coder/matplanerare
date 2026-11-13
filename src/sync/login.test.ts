import { describe, expect, it } from 'vitest'
import { loginError } from './LoginForm'

describe('inloggningsfel på svenska', () => {
  it('översätter de vanligaste felen och behåller okända', () => {
    expect(loginError('Invalid login credentials')).toBe('Fel e-post eller lösenord.')
    expect(loginError('Signups not allowed for this instance')).toMatch(/nya konton/)
    expect(loginError('User already registered')).toMatch(/Logga in i stället/)
    expect(loginError('Något annat')).toBe('Något annat')
  })
  it('översätter felen kring glömt lösenord', () => {
    expect(loginError('New password should be different from the old password.')).toMatch(/ett annat än det gamla/)
    expect(loginError('For security purposes, you can only request this after 42 seconds.')).toBe('Vänta 42 sekunder innan du ber om ett nytt mejl.')
    expect(loginError('email rate limit exceeded')).toMatch(/för många mejl/)
    expect(loginError('Error sending recovery email')).toMatch(/kunde inte skickas/)
    expect(loginError('Auth session missing!')).toMatch(/gäller inte längre/)
    expect(loginError('Password is known to be weak and easy to guess')).toMatch(/lätt att gissa/)
  })
})

describe('länken i mejlet om glömt lösenord', async () => {
  const { readRecoveryLink } = await import('./recovery')
  it('känns igen, liksom en länk som inte gäller längre', () => {
    expect(readRecoveryLink('#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery')).toBe('recovery')
    expect(readRecoveryLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toBe('error')
  })
  it('vanliga adresser och andra inloggningslänkar räknas inte', () => {
    expect(readRecoveryLink('')).toBeNull()
    expect(readRecoveryLink('#planera')).toBeNull()
    expect(readRecoveryLink('#middag-2026-11-15')).toBeNull()
    expect(readRecoveryLink('#access_token=abc&type=signup')).toBeNull()
    expect(readRecoveryLink('#type=recovery')).toBeNull() // ingen inloggning med i länken
  })
})

describe('miljövariabler', async () => {
  const { cleanEnv } = await import('./supabase')
  it('tar bort mellanslag, radbrytning och citattecken', () => {
    expect(cleanEnv(' "sb_publishable_abc" \n')).toBe('sb_publishable_abc')
    expect(cleanEnv('   ')).toBeUndefined()
    expect(cleanEnv(undefined)).toBeUndefined()
  })
})
