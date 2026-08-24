'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

const RULES = [
  { key: "len", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { key: "upper", label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { key: "lower", label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { key: "num", label: "One number", test: (p: string) => /[0-9]/.test(p) },
  { key: "special", label: "One special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH = [
  { label: "Very weak", color: "#E8927C" },
  { label: "Weak", color: "#E8927C" },
  { label: "Fair", color: "#D4A853" },
  { label: "Good", color: "#C9963E" },
  { label: "Strong", color: "#7FD8BE" },
  { label: "Very strong", color: "#7FD8BE" },
];

export default function SignupPage() {
  const { signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<'user' | 'dermatologist'>('user');
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passed = RULES.filter(r => r.test(password)).length;
  const strength = STRENGTH[passed];
  const allRulesMet = passed === RULES.length;
  const usernameValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Collect everything that's missing/invalid and show it in one popup
    const problems: string[] = [];
    if (!username.trim()) problems.push("Enter a username");
    else if (!usernameValid) problems.push("Username must be 3–20 characters (letters, numbers, underscores)");
    if (!email.trim()) problems.push("Enter your email address");
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push("Enter a valid email address");
    RULES.forEach(r => { if (!r.test(password)) problems.push(`Password needs: ${r.label.toLowerCase()}`); });
    if (password && confirm && password !== confirm) problems.push("Passwords do not match");
    else if (!confirm) problems.push("Confirm your password");

    if (problems.length) { setIssues(problems); return; }

    setIsSubmitting(true);
    const { error } = await signUp(email, password, username.trim(), role);
    if (error === 'EMAIL_ALREADY_REGISTERED') { setEmailTaken(true); setIsSubmitting(false); }
    else if (error) { setIssues([error]); setIsSubmitting(false); }
    else setSuccess(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>

      {/* "What's missing" popup */}
      {issues.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-fade-up"
          style={{ background: "rgba(42,31,20,0.35)", backdropFilter: "blur(3px)" }}
          onClick={() => setIssues([])}>
          <div className="glass-card p-7 max-w-sm w-full" onClick={e => e.stopPropagation()}
            style={{ background: "rgba(255,255,255,0.85)" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(232,146,124,0.15)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 6v5M10 14h.01" stroke="#B85040" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="10" cy="10" r="8" stroke="#B85040" strokeWidth="1.5" />
                </svg>
              </div>
              <h3 className="font-semibold text-base" style={{ color: "var(--text)" }}>Please fix the following</h3>
            </div>
            <ul className="space-y-2 mb-6">
              {issues.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#B85040" }} />
                  {p}
                </li>
              ))}
            </ul>
            <button onClick={() => setIssues([])} className="btn-gold w-full py-3 text-sm font-semibold">
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Email already registered → nudge to log in */}
      {emailTaken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-fade-up"
          style={{ background: "rgba(42,31,20,0.35)", backdropFilter: "blur(3px)" }}
          onClick={() => setEmailTaken(false)}>
          <div className="glass-card p-7 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}
            style={{ background: "rgba(255,255,255,0.9)" }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(201,150,62,0.12)" }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 6l8 5 8-5" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3" y="4" width="16" height="14" rx="2" stroke="#C9963E" strokeWidth="1.5" />
              </svg>
            </div>
            <h3 className="font-semibold text-base mb-2" style={{ color: "var(--text)" }}>This email is already registered</h3>
            <p className="text-sm mb-5" style={{ color: "var(--text-dim)" }}>
              An account with <strong>{email}</strong> already exists. Please log in instead.
            </p>
            <Link href="/login" className="btn-gold w-full py-3 text-sm font-semibold inline-block">Go to Sign In</Link>
            <button onClick={() => setEmailTaken(false)} className="w-full py-2.5 mt-2 text-xs" style={{ color: "var(--text-mute)" }}>
              Use a different email
            </button>
          </div>
        </div>
      )}

      {/* Blobs */}
      <div className="animate-float-blob absolute pointer-events-none" style={{
        width: "600px", height: "600px", borderRadius: "50%", top: "-150px", left: "-100px",
        background: "radial-gradient(circle, rgba(127,216,190,0.55) 0%, rgba(100,200,170,0.2) 50%, transparent 70%)", filter: "blur(70px)",
      }} />
      <div className="animate-float-blob-2 absolute pointer-events-none" style={{
        width: "550px", height: "550px", borderRadius: "50%", bottom: "-100px", right: "-100px",
        background: "radial-gradient(circle, rgba(212,168,83,0.6) 0%, rgba(201,150,62,0.25) 50%, transparent 70%)", filter: "blur(70px)",
      }} />

      <div className="relative z-10 w-full max-w-md animate-scale-in">
        <div className="glass-card p-10">
          <div className="text-center mb-8">
            <Link href="/" className="font-display text-3xl inline-block" style={{ color: "var(--text)" }}>
              SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
            </Link>
            <p className="mt-2 text-sm" style={{ color: "var(--text-mute)" }}>Create your free account</p>
          </div>

          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(127,216,190,0.15)" }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M6 14l6 6 10-10" stroke="#7FD8BE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text)" }}>Check your email</h3>
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                We sent a confirmation link to <strong>{email}</strong>
              </p>
              <Link href="/login" className="btn-gold inline-flex items-center px-6 py-3 text-sm mt-6">
                Back to sign in
              </Link>
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
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>I am a</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: 'user', label: 'Common user', desc: 'Scan & track my skin' },
                      { key: 'dermatologist', label: 'Dermatologist', desc: 'Clinician tools & 3D' },
                    ] as const).map(opt => (
                      <button type="button" key={opt.key} onClick={() => setRole(opt.key)}
                        className="text-left px-3 py-2.5 rounded-xl transition-all"
                        style={role === opt.key
                          ? { background: "rgba(201,150,62,0.12)", border: "1px solid var(--gold)", color: "var(--text)" }
                          : { background: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.5)", color: "var(--text-dim)" }}>
                        <div className="text-sm font-semibold">{opt.label}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} required
                    autoComplete="username" placeholder="Choose a username"
                    className="glass-input w-full px-4 py-3.5 text-sm" />
                  {username.length > 0 && !usernameValid && (
                    <p className="text-xs mt-1.5" style={{ color: "#B85040" }}>3–20 characters — letters, numbers, underscores.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    autoComplete="email" placeholder="Enter your email" className="glass-input w-full px-4 py-3.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                    autoComplete="new-password" placeholder="Create a strong password" className="glass-input w-full px-4 py-3.5 text-sm" />

                  {password.length > 0 && (
                    <div className="mt-3">
                      {/* Strength meter */}
                      <div className="flex gap-1 mb-2">
                        {RULES.map((_, i) => (
                          <div key={i} className="flex-1 h-1 rounded-full transition-colors"
                            style={{ background: i < passed ? strength.color : "rgba(42,31,20,0.1)" }} />
                        ))}
                      </div>
                      <div className="text-xs mb-2" style={{ color: strength.color }}>{strength.label}</div>
                      {/* Rules checklist */}
                      <div className="grid grid-cols-1 gap-1">
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
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>Confirm Password</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                    autoComplete="new-password" placeholder="Repeat your password" className="glass-input w-full px-4 py-3.5 text-sm" />
                  {confirm.length > 0 && confirm !== password && (
                    <p className="text-xs mt-1.5" style={{ color: "#B85040" }}>Passwords don&apos;t match.</p>
                  )}
                </div>
                <button type="submit" disabled={isSubmitting}
                  className="btn-gold w-full py-4 text-sm mt-2 flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Creating account…</>
                  ) : "Create Account"}
                </button>
              </form>
              <p className="text-center text-sm mt-6" style={{ color: "var(--text-mute)" }}>
                Already have an account?{" "}
                <Link href="/login" className="font-semibold" style={{ color: "var(--gold)" }}>Sign In</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
