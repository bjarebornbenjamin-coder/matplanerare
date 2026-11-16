import { useState, type CSSProperties, type ReactNode } from 'react'
import { ALLERGENS, DIETS, LIKES, MAX_PORTIONS, MIN_PORTIONS, emptyAnswers, toggleDiet, type Answers } from '../domain/onboarding'
import { finishOnboarding, useOnboarding } from '../lib/onboarding'

/** Antal frågor (välkomstvyn räknas inte). */
const QUESTIONS = 3

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

function portionCaption(n: number): string {
  if (n === 1) return 'Bara till mig'
  if (n === 2) return 'Till två'
  if (n <= 4) return 'Till en liten familj'
  if (n <= 6) return 'Till en stor familj'
  return 'Till ett helt gäng'
}

/** Ett val man slår av och på. */
function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`onb-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7.5" /></svg>
      <span>{children}</span>
    </button>
  )
}

/** Välkomstbilden: en tallrik som ritas upp, med exempel på det frågorna handlar om. */
function Hero() {
  return (
    <div className="onb-hero" aria-hidden="true">
      <svg viewBox="0 0 220 180" className="onb-art">
        <circle className="onb-art-glow" cx="110" cy="92" r="78" />
        <circle className="onb-art-rim" cx="110" cy="92" r="52" />
        <circle className="onb-art-well" cx="110" cy="92" r="34" />
        <path className="onb-art-tool" d="M38 48v26a8 8 0 0 0 16 0V48M46 48v88" />
        <path className="onb-art-tool" d="M176 136V48c10 6 14 22 14 36 0 8-6 12-14 12" />
      </svg>
      <span className="onb-pill p1">4 portioner</span>
      <span className="onb-pill p2">Vegetariskt</span>
      <span className="onb-pill p3">Utan nötter</span>
    </div>
  )
}

/**
 * Frågorna som ställs innan inloggningen: portioner, matpreferenser och allergier. Varje fråga
 * har ett svar som går att gå vidare med direkt, så ingen fråga måste fyllas i.
 */
export function Onboarding({ defaultPortions, hasAccounts, onDone }: { defaultPortions: number; hasAccounts: boolean; onDone?: () => void }) {
  const saved = useOnboarding().answers
  const [a, setA] = useState<Answers>(() => saved ?? emptyAnswers())
  // Den som kommer tillbaka för att ändra sina svar hamnar direkt på första frågan.
  const [step, setStep] = useState(saved ? 1 : 0)
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const [bump, setBump] = useState<'up' | 'down'>('up')
  const portions = a.portions ?? defaultPortions

  const go = (to: number) => {
    setDir(to > step ? 'next' : 'prev')
    setStep(to)
    window.scrollTo(0, 0)
  }
  const finish = (answers: Answers | null) => {
    finishOnboarding(answers)
    onDone?.()
  }
  const setPortions = (n: number) => {
    setBump(n > portions ? 'up' : 'down')
    setA({ ...a, portions: Math.max(MIN_PORTIONS, Math.min(MAX_PORTIONS, n)) })
  }

  return (
    <div className="onb">
      <header className="onb-head">
        {step > 0 ? (
          <button type="button" className="icon-btn" aria-label="Tillbaka" onClick={() => go(step - 1)}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
        ) : <span />}
        <div className="onb-progress" role="progressbar" aria-label="Frågor" aria-valuemin={0} aria-valuemax={QUESTIONS} aria-valuenow={step} aria-valuetext={step === 0 ? 'Inte påbörjat' : `Fråga ${step} av ${QUESTIONS}`}>
          {Array.from({ length: QUESTIONS }, (_, i) => <span key={i} className={i < step ? 'is-on' : ''} />)}
        </div>
        <span className="onb-count num" aria-hidden="true">{step > 0 ? `${step}/${QUESTIONS}` : ''}</span>
      </header>

      <form
        className="onb-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (step < QUESTIONS) go(step + 1)
          else finish(a)
        }}
      >
        <div key={step} className={`onb-step from-${dir}`}>
          {step === 0 && (
            <>
              <Hero />
              <div className="eyebrow">Matplaneraren</div>
              <h1>Veckans mat, planerad efter dig</h1>
              <p className="muted">Svara på tre snabba frågor, så får du en meny som passar hur du äter. Det tar under en minut.</p>
            </>
          )}

          {step === 1 && (
            <>
              <h1 id="onb-q">Hur många portioner per måltid?</h1>
              <p className="muted">Så många som brukar äta. Du kan ändra det när du vill.</p>
              <div className="onb-stepper" role="group" aria-labelledby="onb-q">
                <button type="button" className="onb-round" aria-label="Färre portioner" disabled={portions <= MIN_PORTIONS} onClick={() => setPortions(portions - 1)}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
                </button>
                <output className="onb-number num" aria-live="polite" aria-label={`${portions} ${portions === 1 ? 'portion' : 'portioner'}`}>
                  <span key={portions} className={`onb-digit ${bump}`}>{portions}</span>
                </output>
                <button type="button" className="onb-round" aria-label="Fler portioner" disabled={portions >= MAX_PORTIONS} onClick={() => setPortions(portions + 1)}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
                </button>
              </div>
              <div className="onb-plates" aria-hidden="true">
                {Array.from({ length: portions }, (_, i) => <span key={i} className="onb-dish" style={{ '--i': i } as CSSProperties} />)}
              </div>
              <p className="onb-caption">{portionCaption(portions)}</p>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Hur vill du äta?</h1>
              <p className="muted">Välj allt som stämmer, eller gå vidare direkt.</p>
              <h2 id="onb-diet">Kost</h2>
              <div className="onb-chips" role="group" aria-labelledby="onb-diet">
                <Pick on={a.diets.length === 0} onClick={() => setA({ ...a, diets: [] })}>Äter allt</Pick>
                {DIETS.map((d) => <Pick key={d.id} on={a.diets.includes(d.id)} onClick={() => setA({ ...a, diets: toggleDiet(a.diets, d.id) })}>{d.label}</Pick>)}
              </div>
              <h2 id="onb-likes">Jag gillar</h2>
              <div className="onb-chips" role="group" aria-labelledby="onb-likes">
                {LIKES.map((l) => <Pick key={l.id} on={a.likes.includes(l.id)} onClick={() => setA({ ...a, likes: toggle(a.likes, l.id) })}>{l.label}</Pick>)}
              </div>
              <label className="field onb-other">
                <span>Något annat?</span>
                <input type="text" maxLength={120} placeholder="t.ex. ogillar svamp" value={a.otherLike} onChange={(e) => setA({ ...a, otherLike: e.target.value })} />
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <h1 id="onb-allergy">Något du inte tål?</h1>
              <p className="muted">Menyn och recepten väljs så att de undviker det du markerar.</p>
              <div className="onb-chips" role="group" aria-labelledby="onb-allergy">
                {ALLERGENS.map((x) => <Pick key={x.id} on={a.allergens.includes(x.id)} onClick={() => setA({ ...a, allergens: toggle(a.allergens, x.id) })}>{x.label}</Pick>)}
              </div>
              <label className="field onb-other">
                <span>Annat</span>
                <input type="text" maxLength={120} placeholder="t.ex. selleri" value={a.otherAllergy} onChange={(e) => setA({ ...a, otherAllergy: e.target.value })} />
              </label>
              <p className="muted small">Inget markerat betyder inga allergier. Har du en allvarlig allergi: läs alltid ingredienserna i receptet själv, eftersom AI:n kan ha fel.</p>
            </>
          )}
        </div>

        <footer className="onb-foot">
          <button type="submit" className="btn primary wide onb-cta">{step === 0 ? 'Kom igång' : step < QUESTIONS ? 'Fortsätt' : 'Klar'}</button>
          {step === 0 && <button type="button" className="btn text wide" onClick={() => finish(null)}>{hasAccounts ? 'Jag har redan ett konto' : 'Hoppa över'}</button>}
        </footer>
      </form>
    </div>
  )
}
