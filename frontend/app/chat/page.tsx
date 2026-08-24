'use client';
import { useState, useRef, useEffect, FormEvent } from 'react';
import { supabase } from '@/lib/supabaseClient';
import AppSidebar from '@/components/AppSidebar';
import Markdown from '@/components/Markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED = [
  "What causes acne flare-ups?",
  "Is my routine helping my barrier?",
  "What ingredients should I avoid?",
  "How long until I see improvement?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Please sign in to use the chat.' }]);
        setLoading(false);
        return;
      }
      const about = new URLSearchParams(window.location.search).get('about') || undefined;
      const res = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ message: text, chat_history: messages, condition: about }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : 'Please try again in a moment.';
        setMessages(prev => [...prev, { role: 'assistant', content: `Sorry — ${detail}` }]);
        return;
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response ?? data.message ?? 'Sorry, I could not process that request.',
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection error. Please ensure the backend server is running.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); send(input); };

  // If arriving from an analysis ("Ask about your results"), open with that condition
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    const about = new URLSearchParams(window.location.search).get('about');
    if (about) {
      initRef.current = true;
      send(`I just received a skin analysis result: ${about.replace(/_/g, ' ')}. Can you explain what it means and how I should manage it?`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>
      <AppSidebar />

      <div className="flex flex-col flex-1 overflow-hidden relative">
        {/* Background blobs */}
        <div className="fixed inset-0 pointer-events-none" aria-hidden>
          <div className="animate-float-blob absolute" style={{
            width: "600px", height: "600px", borderRadius: "50%", top: "-100px", right: "-80px",
            background: "radial-gradient(circle, rgba(212,168,83,0.55) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)", filter: "blur(70px)",
          }} />
          <div className="animate-float-blob-2 absolute" style={{
            width: "500px", height: "500px", borderRadius: "50%", bottom: "-60px", left: "-70px",
            background: "radial-gradient(circle, rgba(232,146,124,0.5) 0%, rgba(220,120,100,0.2) 50%, transparent 70%)", filter: "blur(65px)",
          }} />
        </div>

        {/* Chat title bar */}
        <div className="relative z-10 flex items-center gap-3 px-6 py-4 flex-shrink-0"
          style={{ background: "rgba(250,246,241,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.7)" }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(201,150,62,0.1)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M13 9a2 2 0 01-2 2H4L1 14V3a2 2 0 012-2h8a2 2 0 012 2z" stroke="#C9963E" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm" style={{ color: "var(--text)" }}>Skin Assistant</div>
            <div className="text-xs" style={{ color: "var(--text-mute)" }}>Clinical skin guidance, personalised to you</div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 relative z-10">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16 animate-fade-up">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{ background: "rgba(201,150,62,0.1)" }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M25 18a3 3 0 01-3 3H8L3 26V7a3 3 0 013-3h16a3 3 0 013 3z"
                    stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text)" }}>Ask me anything about your skin</h3>
              <p className="text-sm mb-8" style={{ color: "var(--text-mute)" }}>Powered by clinical knowledge and your personal skin history</p>
              <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                {SUGGESTED.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="glass-card-sm p-3 text-xs text-left hover:scale-[1.02] transition-transform cursor-pointer"
                    style={{ color: "var(--text-dim)" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 flex-shrink-0 self-end mb-1"
                  style={{ background: "rgba(201,150,62,0.1)" }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1a6 6 0 100 12A6 6 0 007 1z" stroke="#C9963E" strokeWidth="1.2" />
                    <circle cx="7" cy="7" r="2" stroke="#C9963E" strokeWidth="1.2" />
                  </svg>
                </div>
              )}
              <div className={`max-w-[75%] px-5 py-4 text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-2xl rounded-tr-sm' : 'glass-card-sm rounded-tl-sm'}`}
                style={msg.role === 'user'
                  ? { background: "rgba(201,150,62,0.12)", border: "1px solid rgba(201,150,62,0.2)", color: "var(--text)" }
                  : { color: "var(--text)" }}>
                {msg.role === 'assistant'
                  ? <Markdown text={msg.content} />
                  : msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 flex-shrink-0"
                style={{ background: "rgba(201,150,62,0.1)" }}>
                <div className="w-3 h-3 border border-[#C9963E] border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="glass-card-sm px-5 py-4 rounded-tl-sm">
                <div className="flex gap-1.5 items-center">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="relative z-10 px-4 py-4 flex-shrink-0"
        style={{ background: "rgba(250,246,241,0.85)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.7)" }}>
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your skin…"
            className="glass-input flex-1 px-4 py-3.5 text-sm"
          />
          <button type="submit" disabled={!input.trim() || loading}
            className="btn-gold px-5 py-3.5 flex items-center gap-2 text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14.5 8L2 2l3 6-3 6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>

      </div>  {/* inner flex-col wrapper */}
    </div>
  );
}
