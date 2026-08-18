export const ZONE_INDICES: Record<string, number[]> = {
  forehead:   [10, 151, 107, 66, 105, 63, 70, 156, 124, 122, 119, 117, 123, 147, 213, 138, 127, 34, 21, 71, 68, 104, 109],
  nose:       [4, 5, 1, 2, 3, 195, 197, 6, 19, 20, 94, 125, 354],
  leftCheek:  [50, 205, 206, 207, 187, 147, 123, 116, 111, 101],
  rightCheek: [280, 425, 426, 427, 411, 376, 352, 345, 340, 330],
  chin:       [18, 200, 199, 175, 152, 148, 176, 149, 150, 136],
  perioral:   [0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
};

export type ZoneConditions = Record<string, { condition: string; confidence: number; bbox?: Record<string, number> }>;
export type Landmark = { x: number; y: number; z: number };

export const ZONE_LABEL_COLORS: Record<string, string> = {
  forehead:   'rgba(212,168,83,',
  nose:       'rgba(127,216,190,',
  leftCheek:  'rgba(232,146,124,',
  rightCheek: 'rgba(232,146,124,',
  chin:       'rgba(150,180,255,',
  perioral:   'rgba(255,200,120,',
};

const ZONE_RGB: Record<string, [number, number, number]> = {
  forehead:   [0.83, 0.66, 0.33],
  nose:       [0.50, 0.85, 0.75],
  leftCheek:  [0.91, 0.57, 0.49],
  rightCheek: [0.91, 0.57, 0.49],
  chin:       [0.59, 0.71, 1.00],
  perioral:   [1.00, 0.78, 0.47],
};

const NEUTRAL: [number, number, number] = [0.87, 0.77, 0.66];

export function buildLandmarkZoneMap(): Map<number, string> {
  const map = new Map<number, string>();
  for (const [zone, indices] of Object.entries(ZONE_INDICES)) {
    for (const idx of indices) {
      if (!map.has(idx)) map.set(idx, zone);
    }
  }
  return map;
}

const LM_ZONE_MAP = buildLandmarkZoneMap();

function conditionIntensity(condition: string | null | undefined, confidence: number): number {
  if (!condition || ['clear', 'healthy_skin', 'normal'].includes(condition)) return 0.2;
  return 0.2 + confidence * 0.8;
}

export type RGB = [number, number, number];

export function getHeatmapColor(idx: number, zc: ZoneConditions | null): RGB {
  const zone = LM_ZONE_MAP.get(idx);
  if (!zone || !zc?.[zone]) return NEUTRAL;
  const { condition, confidence } = zc[zone];
  const base = ZONE_RGB[zone] ?? NEUTRAL;
  const t = conditionIntensity(condition, confidence);
  return [
    NEUTRAL[0] + (base[0] - NEUTRAL[0]) * t,
    NEUTRAL[1] + (base[1] - NEUTRAL[1]) * t,
    NEUTRAL[2] + (base[2] - NEUTRAL[2]) * t,
  ];
}

export function getDriftColor(d: number, max: number): RGB {
  const t = max > 0 ? Math.min(d / max, 1) : 0;
  if (t < 0.5) {
    const s = t * 2;
    return [0.50 + s * 0.33, 0.85 - s * 0.19, 0.75 - s * 0.59];
  }
  const s = (t - 0.5) * 2;
  return [0.83 + s * 0.08, 0.66 - s * 0.09, 0.16 + s * 0.33];
}

export function computeDisplacements(a: Landmark[], b: Landmark[]): number[] {
  return a.map((lm, i) => {
    const p = b[i] ?? lm;
    const dx = lm.x - p.x, dy = lm.y - p.y, dz = (lm.z || 0) - (p.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
}

export function landmarkTo3D(lm: Landmark): [number, number, number] {
  return [(lm.x - 0.5) * 2, -(lm.y - 0.5) * 2, (lm.z || 0) * 3];
}

export function getZoneCentroid(landmarks: Landmark[], zone: string): [number, number, number] | null {
  const indices = ZONE_INDICES[zone];
  if (!indices?.length) return null;
  const valid = indices.filter(i => i < landmarks.length);
  if (!valid.length) return null;
  let ax = 0, ay = 0, az = 0;
  for (const i of valid) {
    const [x, y, z] = landmarkTo3D(landmarks[i]);
    ax += x; ay += y; az += z;
  }
  return [ax / valid.length, ay / valid.length, az / valid.length];
}

export function getZoneAvgDrift(displacements: number[], zone: string): number {
  const indices = ZONE_INDICES[zone] ?? [];
  const vals = indices.filter(i => i < displacements.length).map(i => displacements[i]);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
