import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { AiProgress } from '../components/AiProgress'
import { Link } from 'react-router-dom'
import { ChatError, runChat } from '../ai/chat'
import { applyCard, cardView } from '../ai/cards'
import { loadToolContext } from '../ai/context'
import { authHeaders } from '../lib/auth'
import { addChatMessage, clearChat, setCardStatus } from '../db/repo'
import { Markdown } from '../components/Markdown'
import type { ChatMessage } from '../domain/types'
import { useAiConfig, useChat } from '../hooks'

const QUICK_QUESTIONS = [
  { label: 'Vad blir det till middag?', text: 'Vad blir det till middag ikväll?' },
  { label: 'Vad kan jag laga?', text: 'Vad kan jag laga med det jag har hemma?' },
  { label: 'Vad går ut snart?', text: 'Vad i lagret går ut snart, och vad kan jag laga med det?' },
  { label: 'Hur ligger jag till idag?', text: 'Hur ligger jag till idag med mina mål för protein, kolhydrater, fett och vatten?' },
]

function Card({ m }: { m: ChatMessage }) {
  const card = m.card
  if (!card) return null
  const status = m.cardStatus ?? 'pending'
  const view = cardView(card)

  async function confirm() {
    if (!card) return
    await setCardStatus(m.id, await applyCard(card))
  }

  return (
    <div className="card proposal">
      <div className="sub">{view.kicker}</div>
      <div className="title">{view.title}</div>
      {view.lines.map((l, i) => <div key={i} className="sub note">{l}</div>)}
      {status === 'pending' ? (
        <div className="actions" style={{ marginTop: 8 }}>
          <button type="button" className={`btn ${view.danger ? 'danger' : 'primary'}`} onClick={confirm}>{view.confirmLabel}</button>
          <button type="button" className="btn" onClick={() => setCardStatus(m.id, 'dismissed')}>Avvisa</button>
        </div>
      ) : (
        <p className={status === 'done' ? 'done-note' : 'sub'} style={{ marginTop: 8 }}>
          {status === 'dismissed' ? 'Avvisat.' : status === 'missing' ? 'Finns inte längre, inget ändrades.' : <><span aria-hidden="true">✓ </span>{view.doneText}</>}
        </p>
      )}
    </div>
  )
}

export function ChatPage() {
  const config = useAiConfig()
  const messages = useChat()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const [composerH, setComposerH] = useState(190)

  // Mät inmatningsområdet, så att senaste kortet alltid hamnar ovanför det oavsett hur högt det blir.
  useLayoutEffect(() => {
    const el = composerRef.current
    if (!el) return
    const update = () => setComposerH(Math.ceil(el.getBoundingClientRect().height) + 52 + 16)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  })

  const ready = Boolean(config && messages)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, busy, error, ready])

  if (!config || !messages) return null

  async function send(e: FormEvent) {
    e.preventDefault()
    await sendText(text)
  }

  async function sendText(raw: string) {
    const userText = raw.trim()
    if (!userText || busy || !config) return
    setText('')
    setError('')
    setBusy(true)
    const history = messages ?? []
    await addChatMessage({ role: 'user', content: userText })
    try {
      const headers = await authHeaders()
      const { reply, cards, notice } = await runChat({
        headers,
        model: config.model,
        history,
        userText,
        now: new Date(),
        loadContext: loadToolContext,
      })
      await addChatMessage({ role: 'assistant', content: notice ? `${reply}\n\nObs: ${notice}` : reply })
      for (const card of cards) await addChatMessage({ role: 'assistant', content: '', card, cardStatus: 'pending' })
    } catch (err) {
      setError(err instanceof ChatError ? err.message : 'Något gick fel. Försök igen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="chat-head">
        <h1>Chatt</h1>
        {messages.length > 0 && (
          <button type="button" className="btn" onClick={() => confirm('Rensa hela chatten?') && clearChat()}>Rensa</button>
        )}
      </div>

      <div className="chat" aria-live="polite">
        {messages.length === 0 && (
          <p className="empty">Fråga t.ex. "Vad blir det till middag?", "Vad kan jag laga med det jag har hemma?" eller "Lägg mjölk och ägg på inköpslistan".</p>
        )}
        {messages.map((m) =>
          m.card ? (
            <Card key={m.id} m={m} />
          ) : (
            <div key={m.id} className={`bubble ${m.role}`}>{m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}</div>
          ),
        )}
        {(() => {
          const pending = messages.filter((m) => m.card && (m.cardStatus ?? 'pending') === 'pending')
          if (pending.length < 2) return null
          return (
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn primary"
                disabled={confirmingAll}
                onClick={async () => {
                  setConfirmingAll(true)
                  try {
                    // I tur och ordning, så att t.ex. ett nytt ämne finns innan nästa förslag behöver det.
                    for (const m of pending) await setCardStatus(m.id, await applyCard(m.card!))
                  } finally {
                    setConfirmingAll(false)
                  }
                }}
              >
                Bekräfta alla ({pending.length})
              </button>
            </div>
          )
        })()}
        <AiProgress active={busy} expected={8} label="AI:n tänker" />
        {error && (
          <>
            <p className="error" role="alert">{error}</p>
            <div className="actions" style={{ marginTop: 0 }}><Link to="/installningar/ai" className="btn">Testa anslutningen</Link></div>
          </>
        )}
        <div ref={endRef} className="chat-end" style={{ scrollMarginBottom: composerH }} />
      </div>

      <div className="composer-wrap" ref={composerRef}>
      <div className="quick" role="group" aria-label="Snabbfrågor">
        {QUICK_QUESTIONS.map((q) => (
          <button key={q.label} type="button" className="chip" disabled={busy} onClick={() => sendText(q.text)}>{q.label}</button>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <textarea
          rows={1}
          aria-label="Meddelande"
          placeholder="Skriv till assistenten"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Skicka</button>
      </form>
      </div>
    </>
  )
}
