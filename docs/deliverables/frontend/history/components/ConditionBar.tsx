'use client'

export interface Condition {
  condition: string
  confidence: number   // 0–1
}

function formatLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ConditionBar({ conditions }: { conditions: Condition[] }) {
  if (!conditions?.length) return null
  const sorted = [...conditions].sort((a, b) => b.confidence - a.confidence)

  return (
    <div className="space-y-3">
      {sorted.map(({ condition, confidence }) => (
        <div key={condition}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-white/80">{formatLabel(condition)}</span>
            <span className="text-white/50">{Math.round(confidence * 100)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7FD8BE] to-[#5FB8A8] transition-all duration-700"
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
