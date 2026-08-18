'use client';

import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";

/**
 * App chrome shared across authenticated pages: a collapsible left sidebar
 * plus a scrollable main region. Page content is laid out relative to the
 * sidebar (never centered against the whole viewport).
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden"
      style={{ background: "linear-gradient(135deg, #EDD9C0 0%, #E8C9A0 40%, #F0D5C0 100%)" }}>

      <AppSidebar />

      {/* Ambient background — single lightweight layer shared by all pages */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden style={{ zIndex: 0 }}>
        <div className="animate-float-blob absolute" style={{
          width: "560px", height: "560px", borderRadius: "50%", top: "-120px", right: "4%",
          background: "radial-gradient(circle, rgba(212,168,83,0.45) 0%, rgba(201,150,62,0.18) 50%, transparent 70%)", filter: "blur(70px)",
        }} />
        <div className="animate-float-blob-2 absolute" style={{
          width: "460px", height: "460px", borderRadius: "50%", bottom: "2%", left: "18%",
          background: "radial-gradient(circle, rgba(232,146,124,0.4) 0%, rgba(220,120,100,0.15) 50%, transparent 70%)", filter: "blur(65px)",
        }} />
      </div>

      <main className="flex-1 overflow-y-auto relative" style={{ zIndex: 1 }}>
        {children}
      </main>
    </div>
  );
}
