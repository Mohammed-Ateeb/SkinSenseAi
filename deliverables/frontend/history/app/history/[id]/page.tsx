import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

import MetricRing from '@/components/MetricRing'
import ConditionBar, { type Condition } from '@/components/ConditionBar'
import ChatHistoryPanel, { type ChatMessage } from '@/components/ChatHistoryPanel'
import ProgressionCard, { type ProgressionDelta } from '@/components/ProgressionCard'

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalysisResult {
  id: string
  image_id: string
  model_version: string | null
  predictions: Condition[] | null
  primary_condition: string | null
  llm_explanation: string | null
  chat_history?: ChatMessage[]   // persisted via predictions.chat_history (optional)
  recommended_product_ids: string[] | null
  created_at: string
}

interface UploadedImage {
  id: string
  user_id: string
  storage_path: string
  uploaded_at: string
}

interface TwinSnapshot {
  id: string
  analysis_result_id: string | null
  hydration_index: number
  barrier_integrity: number
  dominant_condition: string | null
  active_flare_ups: Record<string, number>
  deltas: {
    hydration_index?: number
    barrier_integrity?: number
    flare_changes?: Record<string, number>
  }
  created_at: string
}

// ── Server-side Supabase client (cookie session) ──────────────────────────────

async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function HistoryDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()

  // Auth guard — RLS would block anyway, but redirect early for better UX
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 1. Fetch analysis result (RLS ensures this belongs to the current user via
  //    the uploaded_images.user_id join chain)
  const { data: result, error: resultError } = await supabase
    .from('analysis_results')
    .select(`
      id,
      image_id,
      model_version,
      predictions,
      primary_condition,
      llm_explanation,
      recommended_product_ids,
      created_at,
      uploaded_images ( id, user_id, storage_path, uploaded_at )
    `)
    .eq('id', params.id)
    .single()

  if (resultError || !result) return notFound()

  const image = (result as any).uploaded_images as UploadedImage | null

  // Ownership check — belt-and-suspenders beyond RLS
  if (image && image.user_id !== user.id) return notFound()

  // Extract chat history persisted into predictions.chat_history (if present)
  const rawPredictions = result.predictions as any
  let conditions: Condition[] = []
  let chatHistory: ChatMessage[] = []

  if (Array.isArray(rawPredictions)) {
    // Standard shape: [{condition, confidence}, ...]
    conditions = rawPredictions as Condition[]
  } else if (rawPredictions && typeof rawPredictions === 'object') {
    // Extended shape: { conditions: [...], chat_history: [...] }
    conditions = rawPredictions.conditions ?? []
    chatHistory = rawPredictions.chat_history ?? []
  }

  // 2. Fetch twin snapshot linked to this analysis result
  const { data: snapshot } = await supabase
    .from('skin_twin_snapshots')
    .select('id, analysis_result_id, hydration_index, barrier_integrity, dominant_condition, active_flare_ups, deltas, created_at')
    .eq('analysis_result_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  const twinSnapshot = snapshot as TwinSnapshot | null

  // 3. Build progression delta — prefer stored deltas from the twin snapshot
  const progression: ProgressionDelta = twinSnapshot
    ? {
        hydration_index: twinSnapshot.deltas.hydration_index ?? null,
        barrier_integrity: twinSnapshot.deltas.barrier_integrity ?? null,
        flare_changes: twinSnapshot.deltas.flare_changes ?? {},
      }
    : { hydration_index: null, barrier_integrity: null, flare_changes: {} }

  const scanDate = new Date(result.created_at).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const scanTime = new Date(result.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-[#0F2027] via-[#203A43] to-[#2C5364]">
      {/* Ambient glows */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-[#7FD8BE]/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-[#E8927C]/15 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10 space-y-6">

        {/* ── Back nav ── */}
        <Link
          href="/history"
          className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to history
        </Link>

        {/* ── Header ── */}
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-white tracking-tight">
                {result.primary_condition
                  ? result.primary_condition.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                  : 'Skin Analysis'}
              </h1>
              <p className="text-sm text-white/50 mt-0.5">
                {scanDate} · {scanTime}
                {result.model_version && (
                  <span className="ml-2 text-white/30">· model {result.model_version}</span>
                )}
              </p>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#7FD8BE]/15 border border-[#7FD8BE]/30 text-[#7FD8BE] text-xs font-medium self-start sm:self-auto">
              {conditions.length > 0 ? `${conditions.length} condition${conditions.length > 1 ? 's' : ''} detected` : 'Analysis complete'}
            </span>
          </div>
        </div>

        {/* ── Twin metrics (hydration + barrier) ── */}
        {twinSnapshot && (
          <section>
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3 px-1">
              Skin Metrics
            </h2>
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6">
              <div className="flex flex-wrap gap-8 justify-center sm:justify-start">
                <MetricRing
                  value={twinSnapshot.hydration_index}
                  label="Hydration Index"
                  color="#7FD8BE"
                />
                <MetricRing
                  value={twinSnapshot.barrier_integrity}
                  label="Barrier Integrity"
                  color="#60a5fa"
                />
                {/* Active flare-ups as additional rings */}
                {Object.entries(twinSnapshot.active_flare_ups).map(([cond, severity]) => (
                  <MetricRing
                    key={cond}
                    value={severity}
                    label={cond.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    color="#E8927C"
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── CNN condition confidences ── */}
        {conditions.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3 px-1">
              Detected Conditions
            </h2>
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6">
              <ConditionBar conditions={conditions} />
            </div>
          </section>
        )}

        {/* ── Progression vs prior scan ── */}
        <section>
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3 px-1">
            Progression vs Prior Scan
          </h2>
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6">
            {twinSnapshot ? (
              <ProgressionCard delta={progression} />
            ) : (
              <p className="text-white/40 text-sm text-center py-4">
                Twin data not yet available for this scan.
              </p>
            )}
          </div>
        </section>

        {/* ── Chat / analysis explanation ── */}
        <section>
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3 px-1">
            Analysis & Chat History
          </h2>
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl p-6">
            <ChatHistoryPanel
              llmExplanation={result.llm_explanation}
              chatHistory={chatHistory}
            />
          </div>
        </section>

        {/* ── Medical disclaimer ── */}
        <p className="text-xs text-white/25 text-center px-4 pb-4">
          This is not medical advice. SkinSense AI is for informational purposes only. Consult a licensed dermatologist for any skin concerns.
        </p>
      </div>
    </div>
  )
}
