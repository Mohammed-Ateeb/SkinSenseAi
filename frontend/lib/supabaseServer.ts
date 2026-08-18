// Cookie-session Supabase client for Next.js App Router (Server Components / Route Handlers).
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
