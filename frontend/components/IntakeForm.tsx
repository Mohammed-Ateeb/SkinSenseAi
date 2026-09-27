'use client';
import { useEffect, useState } from "react";

/**
 * Axis B — the questions a dermatologist would ask while looking at the photo.
 *
 * The photo alone cannot tell hormonal apart from seasonal (hormonal acne and
 * stress acne look identical), so these answers are sent with the image and
 * reweight the model's verdict. Every field is optional: answer none and the
 * result is the raw image prediction.
 *
 * The schema is fetched from GET /analyze/questionnaire so the form and the
 * backend scoring rules can never drift apart.
 */

export interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "choice" | "multi";
  group: "describe" | "details";
  options: string[];
  help: string;
  placeholder: string;
}

export type Answers = Record<string, unknown>;

const GROUP_META: Record<string, { title: string; blurb: string }> = {
  describe: { title: "In your own words", blurb: "Just say what you see and feel." },
  details: { title: "A few details", blurb: "Optional — tap any that apply." },
};

/** "jawline_chin_neck" -> "Jawline chin neck" */
function pretty(v: string): string {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function IntakeForm({
  onChange,
  defaultOpen = false,
}: {
  onChange: (a: Answers) => void;
  defaultOpen?: boolean;
}) {
  const [fields, setFields] = useState<FieldSpec[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [open, setOpen] = useState(defaultOpen);
  const [failed, setFailed] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/analyze/questionnaire`);
        const data = await res.json();
        setFields(Array.isArray(data) ? data : []);
      } catch {
        setFailed(true);
      }
    })();
  }, [apiUrl]);

  function set(key: string, value: unknown) {
    const next = { ...answers };
    if (value === null || value === undefined || value === "" ||
        (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    setAnswers(next);
    onChange(next);
  }

  function toggleMulti(key: string, opt: string) {
    const cur = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
    set(key, cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt]);
  }

  // Hide entirely if the backend schema is unreachable — the analysis still works.
  if (failed || fields.length === 0) return null;

  const answered = Object.keys(answers).length;
  const groups: FieldSpec["group"][] = ["describe", "details"];

  const chip = (active: boolean) => ({
    padding: "5px 11px",
    borderRadius: "999px",
    fontSize: "0.78rem",
    cursor: "pointer",
    transition: "all .15s",
    border: active ? "1px solid var(--gold)" : "1px solid rgba(42,31,20,0.14)",
    background: active ? "rgba(201,150,62,0.14)" : "transparent",
    color: active ? "var(--gold)" : "var(--text-dim)",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div className="glass-card mb-5" style={{ borderRadius: "18px", overflow: "hidden" }}>
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        style={{ background: "transparent", cursor: "pointer" }}
      >
        <span>
          <span className="text-sm font-semibold block" style={{ color: "var(--text)" }}>
            Describe what you&apos;re experiencing {answered > 0 && (
              <span style={{ color: "var(--gold)", fontWeight: 600 }}>· {answered} answered</span>
            )}
          </span>
          <span className="text-xs" style={{ color: "var(--text-mute)" }}>
            Optional — a photo can&apos;t tell us it itches, stings or feels dry. Your words can.
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", color: "var(--text-mute)" }}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 flex flex-col gap-6">
          {groups.map(g => {
            const inGroup = fields.filter(f => f.group === g);
            if (inGroup.length === 0) return null;
            return (
              <div key={g} className="flex flex-col gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--gold)", letterSpacing: "0.08em" }}>
                    {GROUP_META[g].title}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>
                    {GROUP_META[g].blurb}
                  </div>
                </div>

                {inGroup.map(f => (
                  <div key={f.key} className="flex flex-col gap-2">
                    <label htmlFor={`q-${f.key}`} className="text-sm" style={{ color: "var(--text)" }}>
                      {f.label}
                      {f.help && (
                        <span className="block text-xs mt-0.5" style={{ color: "var(--text-mute)" }}>
                          {f.help}
                        </span>
                      )}
                    </label>

                    {f.type === "text" && (
                      <textarea
                        id={`q-${f.key}`}
                        rows={3}
                        placeholder={f.placeholder}
                        value={(answers[f.key] as string | undefined) ?? ""}
                        onChange={e => set(f.key, e.target.value)}
                        className="text-sm px-3 py-2.5 rounded-xl w-full resize-y"
                        style={{
                          border: "1px solid rgba(42,31,20,0.14)",
                          background: "rgba(255,255,255,0.55)",
                          color: "var(--text)",
                          lineHeight: 1.55,
                        }}
                      />
                    )}

                    {f.type === "choice" && (
                      <div id={`q-${f.key}`} className="flex flex-wrap gap-2">
                        {f.options.map(o => (
                          <button key={o} type="button"
                            onClick={() => set(f.key, answers[f.key] === o ? null : o)}
                            style={chip(answers[f.key] === o)}>
                            {pretty(o)}
                          </button>
                        ))}
                      </div>
                    )}

                    {f.type === "multi" && (
                      <div id={`q-${f.key}`} className="flex flex-wrap gap-2">
                        {f.options.map(o => {
                          const cur = Array.isArray(answers[f.key]) ? (answers[f.key] as string[]) : [];
                          return (
                            <button key={o} type="button"
                              onClick={() => toggleMulti(f.key, o)}
                              style={chip(cur.includes(o))}>
                              {pretty(o)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                  </div>
                ))}
              </div>
            );
          })}

          {answered > 0 && (
            <button type="button"
              onClick={() => { setAnswers({}); onChange({}); }}
              className="text-xs self-start underline"
              style={{ color: "var(--text-mute)", background: "none", cursor: "pointer" }}>
              Clear all answers
            </button>
          )}
        </div>
      )}
    </div>
  );
}
