'use client';

import dynamic from 'next/dynamic';
import { useState, useMemo } from 'react';
import { type MeshMode } from './FaceMesh3D';
import { Landmark, ZoneConditions, ZONE_INDICES, ZONE_LABEL_COLORS, computeDisplacements, getZoneAvgDrift } from '@/lib/meshUtils';

const FaceMesh3D = dynamic(() => import('./FaceMesh3D'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Loading 3D viewer…</div>
    </div>
  ),
});

export interface TwinSnapshot {
  snapshot_id: string;
  face_geometry: { landmarks: Landmark[] } | null;
  created_at: string;
  barrier_integrity: number | null;
}

interface TwinViewerProps {
  landmarks: Landmark[] | null;
  zoneConditions: ZoneConditions | null;
  snapshots: TwinSnapshot[];
}

const MODE_INFO: Record<MeshMode, { label: string; desc: string }> = {
  heatmap: { label: 'Condition Heatmap', desc: 'Zones coloured by detected condition severity' },
  drift:   { label: 'Geometry Drift',    desc: 'Per-vertex displacement vs selected scan' },
  clean:   { label: 'Clean Mesh',        desc: 'Natural skin tones, no overlay' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function TwinViewer({ landmarks, zoneConditions, snapshots }: TwinViewerProps) {
  const [mode, setMode] = useState<MeshMode>('heatmap');
  const [compareIdx, setCompareIdx] = useState<number>(0);

  const snapshotsWithGeo = useMemo(
    () => snapshots.filter(s => s.face_geometry?.landmarks?.length),
    [snapshots],
  );

  const previousLandmarks = useMemo(() => {
    if (mode !== 'drift' || !snapshotsWithGeo.length) return undefined;
    return snapshotsWithGeo[Math.min(compareIdx, snapshotsWithGeo.length - 1)]?.face_geometry?.landmarks;
  }, [mode, compareIdx, snapshotsWithGeo]);

  const driftSummary = useMemo(() => {
    if (!landmarks || !previousLandmarks) return null;
    const d = computeDisplacements(landmarks, previousLandmarks);
    return Object.keys(ZONE_INDICES).map(zone => ({
      zone,
      avg: getZoneAvgDrift(d, zone),
      color: ZONE_LABEL_COLORS[zone] + '1)',
    }));
  }, [landmarks, previousLandmarks]);

  const hasGeo = !!landmarks?.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>

      {/* 3D Canvas area */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <FaceMesh3D
          landmarks={landmarks ?? []}
          zoneConditions={zoneConditions}
          previousLandmarks={previousLandmarks}
          mode={mode}
        />
      </div>

      {/* Controls strip */}
      <div style={{
        flexShrink: 0,
        padding: '16px 20px',
        background: 'rgba(250,246,241,0.9)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255,255,255,0.7)',
      }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(Object.keys(MODE_INFO) as MeshMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '7px 0',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: mode === m ? 'rgba(201,150,62,0.15)' : 'rgba(42,31,20,0.05)',
                color: mode === m ? 'var(--gold)' : 'var(--text-mute)',
                outline: mode === m ? '1px solid rgba(201,150,62,0.35)' : 'none',
              }}
            >
              {MODE_INFO[m].label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 10 }}>
          {MODE_INFO[mode].desc}
        </div>

        {/* Drift scan picker */}
        {mode === 'drift' && snapshotsWithGeo.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>Compare to:</span>
            <select
              value={compareIdx}
              onChange={e => setCompareIdx(Number(e.target.value))}
              style={{
                flex: 1,
                fontSize: 11,
                padding: '5px 8px',
                borderRadius: 8,
                border: '1px solid rgba(201,150,62,0.3)',
                background: 'rgba(255,255,255,0.6)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {snapshotsWithGeo.map((s, i) => (
                <option key={s.snapshot_id} value={i}>
                  {formatDate(s.created_at)}
                  {s.barrier_integrity != null ? ` — barrier ${Math.round(s.barrier_integrity * 100)}%` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'drift' && snapshotsWithGeo.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>
            Need at least 2 scans with face data for drift comparison.
          </div>
        )}

        {/* Drift zone summary */}
        {mode === 'drift' && driftSummary && hasGeo && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {driftSummary.map(({ zone, avg, color }) => (
              <div key={zone} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 8,
                background: 'rgba(42,31,20,0.04)',
                fontSize: 10, fontWeight: 500, color: 'var(--text-dim)',
              }}>
                <span style={{ color }}>●</span>
                <span style={{ textTransform: 'capitalize' }}>{zone}</span>
                <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>Δ {(avg * 1000).toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}

        {!hasGeo && (
          <div style={{ fontSize: 11, color: 'var(--text-mute)', textAlign: 'center', marginTop: 4 }}>
            Use the{' '}
            <a href="/analyze" style={{ color: 'var(--gold)', fontWeight: 600 }}>Scan Face</a>
            {' '}tab in Analyze to capture your 3D geometry.
          </div>
        )}
      </div>
    </div>
  );
}
