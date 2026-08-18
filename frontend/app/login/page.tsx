'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) { setError(error); setIsSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #FAF6F1 0%, #F5EFE6 50%, #FBF0E8 100%)" }}>

      {/* Blobs */}
      <div className="animate-float-blob absolute pointer-events-none" style={{
        width: "500px", height: "500px", borderRadius: "50%", top: "-100px", right: "-100px",
        background: "radial-gradient(circle, rgba(212,168,83,0.3) 0%, transparent 70%)", filter: "blur(60px)",
      }} />
      <div className="animate-float-blob-2 absolute pointer-events-none" style={{
        width: "400px", height: "400px", borderRadius: "50%", bottom: "-80px", left: "-80px",
        background: "radial-gradient(circle, rgba(232,146,124,0.25) 0%, transparent 70%)", filter: "blur(50px)",
      }} />
      <div className="animate-float-blob-3 absolute pointer-events-none" style={{
        width: "300px", height: "300px", borderRadius: "50%", top: "50%", left: "20%",
        background: "radial-gradient(circle, rgba(127,216,190,0.18) 0%, transparent 70%)", filter: "blur(40px)",
      }} />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md animate-scale-in">
        <div className="glass-card p-10">
          <div className="text-center mb-8">
            <Link href="/" className="font-display text-3xl inline-block" style={{ color: "var(--text)" }}>
              SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
            </Link>
            <p className="mt-2 text-sm" style={{ color: "var(--text-mute)" }}>Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(232,146,124,0.12)", color: "#B85040", border: "1px solid rgba(232,146,124,0.2)" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Email</label>
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M14 4H2a1 1 0 00-1 1v6a1 1 0 001 1h12a1 1 0 001-1V5a1 1 0 00-1-1zM1 5l7 4.5L15 5" stroke="#A89080" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder="Enter your email" className="glass-input w-full pl-10 pr-4 py-3.5 text-sm" />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium" style={{ color: "var(--text-dim)" }}>Password</label>
                <span className="text-xs cursor-pointer" style={{ color: "var(--gold)" }}>Forgot password?</span>
              </div>
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="7" width="11" height="8" rx="1.5" stroke="#A89080" strokeWidth="1.2" />
                  <path d="M5 7V5a3 3 0 016 0v2" stroke="#A89080" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="Enter your password" className="glass-input w-full pl-10 pr-4 py-3.5 text-sm" />
              </div>
            </div>
            <button type="submit" disabled={isSubmitting}
              className="btn-gold w-full py-4 text-sm mt-2 flex items-center justify-center gap-2">
              {isSubmitting ? (
                <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Signing in…</>
              ) : "Sign In"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-4">
            <div className="flex-1 h-px" style={{ background: "rgba(42,31,20,0.1)" }} />
            <span className="text-xs" style={{ color: "var(--text-mute)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "rgba(42,31,20,0.1)" }} />
          </div>

          <p className="text-center text-sm" style={{ color: "var(--text-mute)" }}>
            New to SkinSense?{" "}
            <Link href="/signup" className="font-semibold" style={{ color: "var(--gold)" }}>Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
