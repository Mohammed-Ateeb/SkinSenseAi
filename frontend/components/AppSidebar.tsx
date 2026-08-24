'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isDermatologist } from "@/lib/role";

const NAV = [
  {
    href: "/dashboard", label: "Dashboard",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /></svg>,
  },
  {
    href: "/analyze", label: "Analyze",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.4" /><path d="M9 2.5V1M9 17v-1.5M2.5 9H1M17 9h-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>,
  },
  {
    href: "/chat", label: "Chat",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M16 11.5a1.5 1.5 0 01-1.5 1.5H5L2 16V4a1.5 1.5 0 011.5-1.5h11A1.5 1.5 0 0116 4z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    href: "/history", label: "History",
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 4v5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4" /></svg>,
  },
  {
    href: "/twin", label: "3D Twin", dermOnly: true,
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2L16 6v6L9 16 2 12V6L9 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M9 2v14M2 6l7 4 7-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>,
  },
  {
    href: "/derm", label: "Clinician", dermOnly: true,
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v5M9 7c0 2.2-1.8 4-4 4a3 3 0 106 0 3 3 0 106 0c-2.2 0-4-1.8-4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.4"/></svg>,
  },
];

const STORAGE_KEY = "skinsense-sidebar-collapsed";

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [label, setLabel] = useState<string>("");
  const [isDerm, setIsDerm] = useState(false);

  // Restore collapse preference
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  // Load the signed-in user's display name (username metadata, else email)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const username = (user.user_metadata as Record<string, unknown> | null)?.username;
      setLabel(typeof username === "string" && username ? username : (user.email ?? ""));
      setIsDerm(isDermatologist(user));
    });
  }, []);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const width = collapsed ? "5rem" : "15rem";

  const railContent = (
    <>
      {/* Brand + collapse toggle */}
      <div className={`flex items-center px-4 py-6 ${collapsed ? "justify-center" : "justify-between"}`} style={{ borderBottom: "1px solid rgba(42,31,20,0.07)" }}>
        {!collapsed ? (
          <>
            <Link href="/dashboard" className="flex items-center gap-2 font-display text-base" style={{ color: "var(--text)" }}>
              <img src="/skinsenseai-icon.png" alt="" width={24} height={24} className="rounded-md" />
              <span>SKIN<span style={{ color: "var(--gold)" }}>SENSE</span></span>
            </Link>
            <button
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              className="w-8 h-8 rounded-lg flex items-center justify-center btn-glass flex-shrink-0"
              style={{ color: "var(--text-dim)" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </>
        ) : (
          <button
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            className="flex items-center justify-center">
            <img src="/skinsenseai-icon.png" alt="SkinSense" width={30} height={30} className="rounded-md" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-6 space-y-1">
        {NAV.filter(item => !("dermOnly" in item) || isDerm).map(item => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href}
              title={collapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${collapsed ? "justify-center" : ""}`}
              style={active
                ? { color: "var(--gold)", background: "rgba(201,150,62,0.1)" }
                : { color: "var(--text-mute)" }}>
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* New analysis CTA */}
      <div className="px-3 pb-4">
        <Link href="/analyze" onClick={() => setMobileOpen(false)}
          title={collapsed ? "New Analysis" : undefined}
          className="btn-gold flex items-center justify-center gap-2 w-full py-3 text-sm font-semibold">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          {!collapsed && "New Analysis"}
        </Link>
      </div>

      {/* User + sign out */}
      <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(42,31,20,0.07)" }}>
        {!collapsed && label && (
          <div className="text-xs truncate mb-2" style={{ color: "var(--text-mute)" }}>{label}</div>
        )}
        <button onClick={signOut}
          title={collapsed ? "Sign out" : undefined}
          className={`text-xs font-medium transition-colors hover:text-[#C9963E] flex items-center gap-2 ${collapsed ? "justify-center w-full" : ""}`}
          style={{ color: "var(--text-mute)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 12H3a1 1 0 01-1-1V3a1 1 0 011-1h2M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {!collapsed && "Sign out"}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-5 py-4 relative z-30"
        style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.8)" }}>
        <button onClick={() => setMobileOpen(true)} aria-label="Open menu"
          className="w-9 h-9 rounded-lg flex items-center justify-center btn-glass" style={{ color: "var(--text-dim)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 font-display text-base" style={{ color: "var(--text)" }}>
          <img src="/skinsenseai-icon.png" alt="" width={22} height={22} className="rounded-md" />
          <span>SKIN<span style={{ color: "var(--gold)" }}>SENSE</span></span>
        </Link>
        <Link href="/analyze" className="btn-gold text-xs font-semibold px-4 py-2">+ Analyze</Link>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMobileOpen(false)}
          style={{ background: "rgba(42,31,20,0.35)", backdropFilter: "blur(2px)" }}>
          <aside onClick={e => e.stopPropagation()}
            className="flex flex-col h-full w-64"
            style={{ background: "rgba(250,246,241,0.96)", backdropFilter: "blur(20px)", borderRight: "1px solid rgba(255,255,255,0.85)" }}>
            {railContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col flex-shrink-0 transition-[width] duration-200"
        style={{ width, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", borderRight: "1px solid rgba(255,255,255,0.85)" }}>
        {railContent}
      </aside>
    </>
  );
}
