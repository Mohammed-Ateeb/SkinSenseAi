// EXAMPLE route wiring — copy to src/app/twin/page.tsx and rename to page.tsx.
// Server Component: fetches the twin under the cookie session, then hands the
// resolved payload to the client dashboard. Redirects unauthenticated users.
import { redirect } from "next/navigation";
import { fetchDigitalTwin } from "./lib/fetchTwin";
import DigitalTwinDashboard from "./components/DigitalTwinDashboard";

export const dynamic = "force-dynamic"; // per-request; reads the session cookie

export default async function TwinPage() {
  const twin = await fetchDigitalTwin();

  if (!twin) {
    // No session (or no twin yet). Adjust target to your app's auth/onboarding route.
    redirect("/login");
  }

  return (
    <main className="min-h-screen">
      <DigitalTwinDashboard twin={twin} />
    </main>
  );
}
