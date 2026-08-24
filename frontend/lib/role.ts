/**
 * Lightweight role check. Dermatologist-only features (the 3D digital twin and
 * the clinician view) are gated on this; normal users get the 2D capture flow.
 *
 * A user is a dermatologist when their Supabase `user_metadata` has
 *   role: "dermatologist" | "clinician" | "derm" | "doctor"
 * or   is_dermatologist: true
 *
 * Set it in Supabase → Authentication → Users → the user → User Metadata, e.g.
 *   { "role": "dermatologist" }
 */

type MaybeUser = { user_metadata?: Record<string, unknown> | null } | null | undefined;

const DERM_ROLES = new Set(["dermatologist", "clinician", "derm", "doctor"]);

export function isDermatologist(user: MaybeUser): boolean {
  const meta = user?.user_metadata ?? {};
  const role = String((meta as Record<string, unknown>).role ?? "").toLowerCase();
  return DERM_ROLES.has(role) || (meta as Record<string, unknown>).is_dermatologist === true;
}
