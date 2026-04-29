'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

interface ChatMessage {
  id?: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt?: string
}

interface Nudge {
  type: 'overdue' | 'order'
  text: string
  action: string
}

export function ChatPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [nudges, setNudges] = useState<Nudge[]>([])
  const [nudgesLoaded, setNudgesLoaded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load chat history and nudges on first open
  useEffect(() => {
    if (isOpen && !historyLoaded) {
      fetch('/api/chat')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setMessages(data.map((m: any) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })))
          }
          setHistoryLoaded(true)
        })
        .catch(() => setHistoryLoaded(true))
    }
    if (isOpen && !nudgesLoaded) {
      fetch('/api/briefing')
        .then((r) => r.json())
        .then((data) => {
          const items: Nudge[] = []
          for (const o of (data.overdue || []).slice(0, 3)) {
            const who = o.assignedTo || 'Someone'
            const step = (o.step || '').replace(/_/g, ' ').toLowerCase()
            items.push({
              type: 'overdue',
              text: `${who}'s ${step} for ${o.building || o.project} is ${o.daysOverdue}d overdue`,
              action: `Send ${who} a reminder about ${step}`,
            })
          }
          for (const o of (data.ordersNeeded || []).slice(0, 2)) {
            items.push({
              type: 'order',
              text: `${(o.item || '').replace(/_/g, ' ')} for ${o.building || o.project} needs ordering`,
              action: `What's the order status for ${o.building || o.project}?`,
            })
          }
          setNudges(items)
          setNudgesLoaded(true)
        })
        .catch(() => setNudgesLoaded(true))
    }
  }, [isOpen, historyLoaded, nudgesLoaded])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'USER', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-20).map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
        }),
      })

      const data = await res.json()
      if (data.reply) {
        setMessages((prev) => [...prev, { role: 'ASSISTANT', content: data.reply }])
      } else {
        setMessages((prev) => [...prev, { role: 'ASSISTANT', content: 'Sorry, something went wrong.' }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'ASSISTANT', content: 'Connection error. Try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 420, maxWidth: '100vw',
      background: 'var(--bg)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 200,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#6ee7b7', flexShrink: 0,
          }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.06em', color: 'var(--text)', fontWeight: 600 }}>
            FIELDSTACK AI
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '4px 8px',
          }}
        >
          &times;
        </button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Nudge cards */}
        {nudges.length > 0 && messages.length === 0 && !loading && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
              Needs attention
            </div>
            {nudges.map((nudge, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px', marginBottom: 6,
                  background: nudge.type === 'overdue' ? 'rgba(248,113,113,0.06)' : 'rgba(251,191,36,0.06)',
                  border: `1px solid ${nudge.type === 'overdue' ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)'}`,
                  borderRadius: 8, fontSize: 12,
                }}
              >
                <div style={{ color: 'var(--text)', marginBottom: 6 }}>{nudge.text}</div>
                <button
                  onClick={() => { setInput(nudge.action); inputRef.current?.focus() }}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    color: nudge.type === 'overdue' ? 'var(--danger)' : 'var(--warn)',
                    fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer',
                    textDecoration: 'underline', textUnderlineOffset: 2,
                  }}
                >
                  {nudge.action} →
                </button>
              </div>
            ))}
          </div>
        )}

        {messages.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: nudges.length > 0 ? '16px 20px' : '40px 20px' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              {nudges.length > 0 ? 'Or ask me anything' : 'Ask me anything about your projects'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                "What's my daily briefing?",
                'Any overdue tasks?',
                'Show me order status',
                "What's happening with Lexington?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus() }}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '8px 12px',
                    color: 'var(--text)',
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--mono)',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'USER' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}
          >
            {msg.role === 'ASSISTANT' && (
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)',
                marginBottom: 4, letterSpacing: '0.06em',
              }}>
                FIELDSTACK AI
              </div>
            )}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                ...(msg.role === 'USER'
                  ? {
                      background: 'var(--accent)',
                      color: '#0f0f11',
                      borderBottomRightRadius: 3,
                    }
                  : {
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderBottomLeftRadius: 3,
                    }),
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)',
              marginBottom: 4, letterSpacing: '0.06em',
            }}>
              FIELDSTACK AI
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 10, borderBottomLeftRadius: 3,
              background: 'var(--surface)', border: '1px solid var(--border)',
              fontSize: 13, color: 'var(--muted)',
            }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', gap: 8,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '4px 4px 4px 12px',
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your projects..."
            rows={1}
            style={{
              flex: 1, background: 'none', border: 'none',
              color: 'var(--text)', fontSize: 13,
              resize: 'none', outline: 'none',
              padding: '8px 0',
              maxHeight: 100, overflowY: 'auto',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{
              background: input.trim() && !loading ? 'var(--accent)' : 'var(--surface2)',
              color: input.trim() && !loading ? '#0f0f11' : 'var(--muted)',
              border: 'none',
              borderRadius: 'var(--radius)',
              padding: '8px 14px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              fontWeight: 600,
              cursor: input.trim() && !loading ? 'pointer' : 'default',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
