'use client'

export interface ProgressionDelta {
  hydration_index: number | null      // signed float; null = no prior scan
  barrier_integrity: number | null
  flare_changes: Record<string, number>
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-white/40 text-xs">—</span>
  const pct = Math.round(delta * 100)
  const positive = pct >= 0
  return (
    <span
      className={`text-sm font-medium ${positive ? 'text-emerald-400' : 'text-rose-400'}`}
    >
      {positive ? '+' : ''}{pct}%
    </span>
  )
}

function formatLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ProgressionCard({ delta }: { delta: ProgressionDelta }) {
  const hasFlares = Object.keys(delta.flare_changes).length > 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white/5 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-white/50 text-xs">Hydration vs prior scan</span>
          <DeltaBadge delta={delta.hydration_index} />
          {delta.hydration_index === null && (
            <span className="text-white/30 text-xs">First scan — no comparison</span>
          )}
        </div>
        <div className="bg-white/5 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-white/50 text-xs">Barrier integrity vs prior scan</span>
          <DeltaBadge delta={delta.barrier_integrity} />
          {delta.barrier_integrity === null && (
            <span className="text-white/30 text-xs">First scan — no comparison</span>
          )}
        </div>
      </div>

      {hasFlares && (
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          <span className="text-white/50 text-xs block mb-2">Condition changes</span>
          {Object.entries(delta.flare_changes).map(([condition, change]) => (
            <div key={condition} className="flex justify-between items-center">
              <span className="text-white/80 text-sm">{formatLabel(condition)}</span>
              <DeltaBadge delta={change} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
