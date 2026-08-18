'use client';
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }}
      className="text-xs font-medium transition-colors hover:text-[#C9963E]"
      style={{ color: "var(--text-mute)" }}
    >
      Sign out
    </button>
  );
}
