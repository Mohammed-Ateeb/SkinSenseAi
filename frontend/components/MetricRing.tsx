'use client'

interface MetricRingProps {
  value: number        // 0–1
  label: string
  color: string        // Tailwind stroke colour token or hex
  size?: number        // px, default 120
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS // ≈251.33

export default function MetricRing({ value, label, color, size = 120 }: MetricRingProps) {
  const clamped = Math.max(0, Math.min(1, value))
  const offset = CIRCUMFERENCE * (1 - clamped)
  const pct = Math.round(clamped * 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="drop-shadow-lg"
      >
        {/* Track */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="10"
        />
        {/* Progress arc — starts from 12 o'clock */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
          className="transition-all duration-700 ease-out"
        />
        {/* Centre label */}
        <text
          x="50"
          y="46"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="18"
          fontWeight="600"
        >
          {pct}%
        </text>
      </svg>
      <span className="text-xs text-white/60 text-center leading-tight">{label}</span>
    </div>
  )
}
