// Cookie-session Supabase client for Next.js App Router (Server Components / Route Handlers).
//
// The existing frontend authenticates users via Supabase and persists the session
// in cookies. `@supabase/ssr` is the canonical way to read that cookie session on
// the server so RLS-protected queries run AS the logged-in user.
//
// If the project currently only has `@supabase/supabase-js` installed, add:
//   npm install @supabase/ssr
//
// Uses the same env vars already in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Build a request-scoped Supabase client bound to the incoming cookie session.
 * Call inside a Server Component, Server Action, or Route Handler.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Components can't set cookies; this is a no-op there and only
          // takes effect in Route Handlers / Server Actions. Wrapped in try/catch
          // so a read-only render context doesn't throw.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
      },
    }
  );
}
