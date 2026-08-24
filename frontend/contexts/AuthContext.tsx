'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

type AuthContextType = {
  user: User | null
  session: Session | null
  loading: boolean
  signUp: (email: string, password: string, username: string, role?: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load existing session on mount (keeps user logged in across refreshes)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, username: string, role?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // role is read by isDermatologist() to gate the 3D/clinician views.
      options: { data: { username, role: role === 'dermatologist' ? 'dermatologist' : 'user' } },
    })
    // Supabase obfuscates an existing email by returning a user with no identities
    // (no error). Detect it so we can tell the user to log in instead.
    if (!error && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: 'EMAIL_ALREADY_REGISTERED' }
    }
    if (error && /already registered|already exists|already been registered/i.test(error.message)) {
      return { error: 'EMAIL_ALREADY_REGISTERED' }
    }
    return { error: error?.message ?? null }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    // Hard redirect clears session cookies the middleware reads
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
