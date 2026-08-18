'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const { error } = await signIn(email, password)

    if (error) {
      setError(error)
      setIsSubmitting(false)
    }
    // On success, signIn() already redirects to /dashboard
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-[#0F2027] via-[#203A43] to-[#2C5364] px-4">
      {/* Ambient glow accents */}
      <div className="absolute top-1/4 -left-24 w-72 h-72 bg-[#7FD8BE]/20 rounded-full blur-[100px]" />
      <div className="absolute bottom-1/4 -right-24 w-72 h-72 bg-[#E8927C]/20 rounded-full blur-[100px]" />

      <div className="relative w-full max-w-md">
        {/* Glass card */}
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold text-white tracking-tight">
              Welcome back
            </h1>
            <p className="text-sm text-white/60 mt-2">
              Log in to see your skin history and recommendations
            </p>
          </div>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-400/30 text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm text-white/70 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#7FD8BE]/50 focus:border-[#7FD8BE]/50 transition"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm text-white/70 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#7FD8BE]/50 focus:border-[#7FD8BE]/50 transition"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 rounded-lg bg-gradient-to-r from-[#7FD8BE] to-[#5FB8A8] text-[#0F2027] font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {isSubmitting ? 'Logging in...' : 'Log in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-white/60">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-[#7FD8BE] hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
