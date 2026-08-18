'use client';
import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

const RULES = [
  { key: "len", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { key: "upper", label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { key: "lower", label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { key: "num", label: "One number", test: (p: string) => /[0-9]/.test(p) },
  { key: "special", label: "One special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Supabase fires PASSWORD_RECOVERY once it parses the link's token from the URL
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) setReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  const passed = RULES.filter(r => r.test(password)).length;
  const allRulesMet = passed === RULES.length;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!allRulesMet) { setError("Please meet all password requirements below."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);
    if (error) setError(error.message);
    else setDone(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>

      <div className="animate-float-blob absolute pointer-events-none" style={{
        width: "600px", height: "600px", borderRadius: "50%", top: "-150px", left: "-100px",
        background: "radial-gradient(circle, rgba(212,168,83,0.6) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)", filter: "blur(70px)",
      }} />

      <div className="relative z-10 w-full max-w-md animate-scale-in">
        <div className="glass-card p-10">
          <div className="text-center mb-8">
            <Link href="/" className="font-display text-3xl inline-block" style={{ color: "var(--text)" }}>
              SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
            </Link>
            <p className="mt-2 text-sm" style={{ color: "var(--text-mute)" }}>Set a new password</p>
          </div>

          {done ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(127,216,190,0.15)" }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M6 14l6 6 10-10" stroke="#7FD8BE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text)" }}>Password updated</h3>
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>You can now sign in with your new password.</p>
              <Link href="/login" className="btn-gold inline-flex items-center px-6 py-3 text-sm mt-6">
                Go to sign in
              </Link>
            </div>
          ) : !ready ? (
            <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-4"
                style={{ borderColor: "rgba(201,150,62,0.2)", borderTopColor: "var(--gold)" }} />
              Verifying your reset link…
              <p className="mt-3 text-xs" style={{ color: "var(--text-mute)" }}>
                If this doesn&apos;t continue, request a{" "}
                <Link href="/forgot-password" className="font-semibold" style={{ color: "var(--gold)" }}>new link</Link>.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>New password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                    autoComplete="new-password" placeholder="Create a strong password" className="glass-input w-full px-4 py-3.5 text-sm" />
                  {password.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-1">
                      {RULES.map(r => {
                        const ok = r.test(password);
                        return (
                          <div key={r.key} className="flex items-center gap-2 text-xs"
                            style={{ color: ok ? "var(--text-dim)" : "var(--text-mute)" }}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              {ok
                                ? <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#7FD8BE" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                : <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2" />}
                            </svg>
                            {r.label}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Confirm new password</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                    autoComplete="new-password" placeholder="Repeat your password" className="glass-input w-full px-4 py-3.5 text-sm" />
                </div>
                <button type="submit" disabled={isSubmitting}
                  className="btn-gold w-full py-4 text-sm mt-2 flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Updating…</>
                  ) : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
