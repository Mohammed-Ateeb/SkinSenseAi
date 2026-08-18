# SkinSense AI — Auth Setup

## 1. Environment variables

**Frontend** (`.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Backend** (`.env` or environment):
```
SUPABASE_JWT_SECRET=your-jwt-secret
```
Find this in Supabase Dashboard → Project Settings → API → JWT Secret.

## 2. Install dependencies

```bash
# Frontend
npm install @supabase/supabase-js

# Backend
pip install pyjwt
```

## 3. Wrap your app with AuthProvider

In `app/layout.tsx`:
```tsx
import { AuthProvider } from "@/context/AuthContext";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

## 4. Protect routes (e.g. dashboard, analyze, chat)

```tsx
"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading || !user) return <p>Loading…</p>;
  return <>{children}</>;
}
```

## 5. Attach the token when calling FastAPI

```tsx
const { session } = useAuth();

const res = await fetch("http://localhost:8000/analyze", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ /* ... */ }),
});
```

## 6. Protect FastAPI endpoints

```python
from fastapi import Depends
from backend.auth import get_current_user

@app.post("/analyze")
def analyze_skin(payload: AnalyzeRequest, user=Depends(get_current_user)):
    user_id = user["sub"]  # Supabase user UUID — use this to save/query history
    ...
```

## 7. History table (Postgres)

Give each history/scan row a `user_id` column referencing `auth.users(id)`,
then filter queries by `user_id = auth.uid()` via a Supabase Row Level
Security (RLS) policy — this is what actually keeps one user from seeing
another's history, on top of just checking the JWT in FastAPI.

Example RLS policy:
```sql
create policy "Users can view their own history"
  on scan_history for select
  using (auth.uid() = user_id);
```

## Notes
- Email confirmation is on by default in Supabase — you can disable it in
  Authentication → Providers → Email if you want instant login after signup
  for your demo/viva.
- If you later want Google OAuth too, `supabase.auth.signInWithOAuth({ provider: "google" })`
  is a one-liner addition to the existing login page.
