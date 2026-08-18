'use client';
import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

function BlobBg() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="animate-float-blob absolute" style={{
        width: "600px", height: "600px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(212,168,83,0.28) 0%, transparent 70%)",
        filter: "blur(60px)", top: "-100px", right: "-100px",
      }} />
      <div className="animate-float-blob-2 absolute" style={{
        width: "500px", height: "500px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(232,146,124,0.22) 0%, transparent 70%)",
        filter: "blur(50px)", bottom: "0", left: "-80px",
      }} />
      <div className="animate-float-blob-3 absolute" style={{
        width: "400px", height: "400px", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(127,216,190,0.18) 0%, transparent 70%)",
        filter: "blur(40px)", top: "40%", left: "38%",
      }} />
    </div>
  );
}

const FEATURES = [
  {
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#C9963E" strokeWidth="1.5"/><circle cx="12" cy="12" r="4" stroke="#C9963E" strokeWidth="1.5"/><path d="M12 2.5V1M12 23v-1.5M2.5 12H1M23 12h-1.5" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round"/></svg>,
    title: "AI Skin Analysis",
    desc: "EfficientNet-B0 CNN classifies 6 dermatological conditions with calibrated confidence in under 60 seconds.",
  },
  {
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round"/><path d="M16 3l2 2-5 5" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 12h8M12 8v8" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round"/></svg>,
    title: "Digital Skin Twin",
    desc: "A persistent model of your skin state — barrier integrity, hydration index, and flare-ups tracked over time.",
  },
  {
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    title: "AI Chatbot",
    desc: "Ask anything about your skin. Conversation history saved — pick up where you left off, any time.",
  },
  {
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="#C9963E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" stroke="#C9963E" strokeWidth="1.5"/></svg>,
    title: "OTC Recommendations",
    desc: "Product recommendations from a curated list — AI-guardrailed, no prescriptions, no hallucinations.",
  },
];

const STEPS = [
  "Photograph your skin concern",
  "AI classifies — 6 conditions, calibrated confidence",
  "LLM explains causes, symptoms, prevention schedule",
  "Digital Twin updates — track your improvement over time",
];

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tl = gsap.timeline({ delay: 0.1 });
    tl.from(".hero-tag", { y: 16, opacity: 0, duration: 0.5, ease: "power2.out" })
      .from(".hero-title .word", { y: 60, opacity: 0, duration: 0.8, stagger: 0.07, ease: "power3.out" }, "-=0.2")
      .from(".hero-sub", { y: 20, opacity: 0, duration: 0.6, ease: "power2.out" }, "-=0.4")
      .from(".hero-actions .action-btn", { y: 16, opacity: 0, duration: 0.5, stagger: 0.1, ease: "power2.out" }, "-=0.35")
      .from(".hero-stat", { y: 12, opacity: 0, duration: 0.5, stagger: 0.08 }, "-=0.3");

    ScrollTrigger.batch(".feature-card", {
      onEnter: batch => gsap.from(batch, { y: 40, opacity: 0, duration: 0.7, stagger: 0.1, ease: "power3.out" }),
      start: "top 85%",
    });

    gsap.from(".step-item", {
      x: -30, opacity: 0, duration: 0.7, stagger: 0.15, ease: "power3.out",
      scrollTrigger: { trigger: "#how", start: "top 80%", toggleActions: "play none none none" },
    });

    gsap.from(".cta-block", {
      y: 40, opacity: 0, duration: 0.8, ease: "power3.out",
      scrollTrigger: { trigger: "#cta", start: "top 80%", toggleActions: "play none none none" },
    });
  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="min-h-screen overflow-x-hidden" style={{ background: "var(--cream)" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}><BlobBg /></div>

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-12 h-16"
        style={{ background: "rgba(250,246,241,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.6)" }}>
        <span className="font-display text-lg" style={{ color: "var(--text)" }}>
          SKIN<span style={{ color: "var(--gold)" }}>SENSE</span>
        </span>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: "var(--text-mute)" }}>
          <a href="#features" className="hover:text-[#C9963E] transition-colors">Features</a>
          <a href="#how" className="hover:text-[#C9963E] transition-colors">How it works</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium px-4 py-2 transition-colors" style={{ color: "var(--text-dim)" }}>Sign in</Link>
          <Link href="/signup" className="btn-gold text-sm px-5 py-2.5">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 text-center" style={{ zIndex: 1 }}>
        <div className="max-w-4xl mx-auto">
          <div className="hero-tag inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 glass-card-sm text-sm font-medium" style={{ color: "var(--gold)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: "var(--gold)" }} />
            AI-Powered Dermatology
          </div>
          <h1 className="hero-title font-display text-[4.5rem] sm:text-[6rem] md:text-[7.5rem] mb-8" style={{ color: "var(--text)" }}>
            <span className="word inline-block">DISCOVER</span>{" "}
            <span className="word inline-block" style={{ color: "var(--gold)" }}>WHAT</span>{" "}
            <span className="word inline-block">YOUR</span>{" "}
            <span className="word inline-block" style={{ color: "var(--coral)" }}>SKIN</span><br />
            <span className="word inline-block">TRULY NEEDS.</span>
          </h1>
          <p className="hero-sub text-lg max-w-xl mx-auto mb-10 leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
            AI analysis of 6 skin conditions in under 60 seconds — with a Digital Skin Twin that tracks your recovery over time.
          </p>
          <div className="hero-actions flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/signup" className="action-btn btn-gold inline-flex items-center justify-center gap-2 px-8 py-4 text-base">
              Start Free Analysis
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3.5 9h11M10 5l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
            <a href="#how" className="action-btn btn-glass inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-medium">
              How it works
            </a>
          </div>
          <div className="flex flex-wrap justify-center gap-8">
            {[{ val: "6", label: "Conditions Detected" }, { val: "<60s", label: "Analysis Time" }, { val: "100%", label: "Image Privacy" }].map(s => (
              <div key={s.label} className="hero-stat text-center">
                <div className="font-display text-[2.5rem]" style={{ color: "var(--gold)" }}>{s.val}</div>
                <div className="text-xs font-medium mt-1" style={{ color: "var(--text-mute)" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 relative" style={{ zIndex: 1 }}>
        <div className="max-w-5xl mx-auto">
          <div className="divider mb-6 mx-auto" />
          <h2 className="font-display text-[3rem] md:text-[4rem] text-center mb-4" style={{ color: "var(--text)" }}>EVERYTHING YOU NEED</h2>
          <p className="text-center text-base mb-14 max-w-lg mx-auto" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
            From instant classification to longitudinal tracking — the only tool with a persistent Digital Skin Twin.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="feature-card glass-card p-8">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(201,150,62,0.1)" }}>
                  {f.icon}
                </div>
                <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text)" }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-24 px-6 relative" style={{ zIndex: 1, background: "rgba(245,239,230,0.5)" }}>
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-[3rem] md:text-[4rem] mb-14" style={{ color: "var(--text)" }}>
            HOW IT <span style={{ color: "var(--gold)" }}>WORKS</span>
          </h2>
          {STEPS.map((step, i) => (
            <div key={i} className="step-item flex items-start gap-6 mb-8">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: i === 0 ? "var(--gold)" : "rgba(201,150,62,0.12)", color: i === 0 ? "white" : "var(--gold)" }}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="glass-card-sm px-6 py-4 flex-1">
                <span className="font-medium" style={{ color: "var(--text)" }}>{step}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="py-32 px-6 text-center relative" style={{ zIndex: 1 }}>
        <div className="cta-block max-w-xl mx-auto glass-card p-14">
          <h2 className="font-display text-[3.5rem] md:text-[5rem] mb-4" style={{ color: "var(--text)" }}>
            START <span style={{ color: "var(--gold)" }}>TODAY.</span>
          </h2>
          <p className="text-base mb-8 leading-relaxed" style={{ color: "var(--text-dim)", fontWeight: 300 }}>
            Free. No credit card. First analysis in under 60 seconds.
          </p>
          <Link href="/signup" className="btn-gold inline-flex items-center gap-3 px-10 py-4 text-base">
            Create your account
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3.5 9h11M10 5l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 md:px-12 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 relative"
        style={{ zIndex: 1, borderTop: "1px solid rgba(42,31,20,0.08)" }}>
        <span className="font-display text-sm" style={{ color: "var(--text-mute)" }}>SKINSENSE AI</span>
        <span className="text-xs text-center" style={{ color: "var(--text-mute)" }}>For informational purposes only. Not medical advice.</span>
        <div className="flex gap-5 text-xs" style={{ color: "var(--text-mute)" }}>
          <Link href="/login" className="hover:text-[#C9963E] transition-colors">Sign in</Link>
          <Link href="/signup" className="hover:text-[#C9963E] transition-colors">Sign up</Link>
        </div>
      </footer>
    </div>
  );
}
