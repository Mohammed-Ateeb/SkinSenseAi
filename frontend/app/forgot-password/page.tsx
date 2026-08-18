'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setIsSubmitting(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>

      <div className="animate-float-blob absolute pointer-events-none" style={{
        width: "600px", height: "600px", borderRadius: "50%", top: "-150px", right: "-120px",
        background: "radial-gradient(circle, rgba(212,168,83,0.6) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)", filter: "blur(70px)",
      }} />
      <div className="animate-float-blob-2 absolute pointer-events-none" style={{
        width: "500px", height: "500px", borderRadius: "50%", bottom: "-100px", left: "-100px",
        background: "radial-gradient(circle, rgba(127,216,190,0.5) 0%, rgba(100,200,170,0.2) 50%, transparent 70%)", filter: "blur(60px)",
      }} />

      <div className="relative z-10 w-full max-w-md animate-scale-in">
        <div className="glass-card p-10">
          <div className="text-center mb-8">
            <Link href="/" className="font-display text-3xl inline-block" style={{ color: "var(--text)" }}>
              SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
            </Link>
            <p className="mt-2 text-sm" style={{ color: "var(--text-mute)" }}>Reset your password</p>
          </div>

          {sent ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(127,216,190,0.15)" }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M4 7h20v14H4zM4 7l10 7 10-7" stroke="#7FD8BE" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text)" }}>Check your email</h3>
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                If an account exists for <strong>{email}</strong>, we&apos;ve sent a password-reset link.
              </p>
              <Link href="/login" className="btn-gold inline-flex items-center px-6 py-3 text-sm mt-6">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm mb-5 leading-relaxed" style={{ color: "var(--text-dim)" }}>
                Enter the email linked to your account and we&apos;ll send you a link to set a new password.
              </p>
              {error && (
                <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    autoComplete="email" placeholder="Enter your email" className="glass-input w-full px-4 py-3.5 text-sm" />
                </div>
                <button type="submit" disabled={isSubmitting}
                  className="btn-gold w-full py-4 text-sm mt-2 flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Sending…</>
                  ) : "Send reset link"}
                </button>
              </form>
              <p className="text-center text-sm mt-6" style={{ color: "var(--text-mute)" }}>
                Remembered it?{" "}
                <Link href="/login" className="font-semibold" style={{ color: "var(--gold)" }}>Sign In</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
