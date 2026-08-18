'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import Delaunator from 'delaunator';
import {
  Landmark, ZoneConditions, ZONE_INDICES, ZONE_LABEL_COLORS,
  getHeatmapColor, getDriftColor, computeDisplacements,
  landmarkTo3D, getZoneCentroid, getZoneAvgDrift,
} from '@/lib/meshUtils';

export type MeshMode = 'heatmap' | 'drift' | 'clean';

export interface FaceMesh3DProps {
  landmarks: Landmark[];
  zoneConditions: ZoneConditions | null;
  previousLandmarks?: Landmark[];
  mode: MeshMode;
}

const MAX_EDGE_SQ = 0.006;

function buildGeometry(
  landmarks: Landmark[],
  zoneConditions: ZoneConditions | null,
  previousLandmarks: Landmark[] | undefined,
  mode: MeshMode,
): THREE.BufferGeometry | null {
  if (!landmarks?.length) return null;

  const flatCoords = new Float64Array(landmarks.length * 2);
  landmarks.forEach((lm, i) => { flatCoords[i * 2] = lm.x; flatCoords[i * 2 + 1] = lm.y; });

  let del: Delaunator<Float64Array>;
  try { del = new Delaunator(flatCoords); } catch { return null; }

  const positions = new Float32Array(landmarks.length * 3);
  landmarks.forEach((lm, i) => {
    const [x, y, z] = landmarkTo3D(lm);
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
  });

  const validIdx: number[] = [];
  for (let t = 0; t < del.triangles.length; t += 3) {
    const [a, b, c] = [del.triangles[t], del.triangles[t + 1], del.triangles[t + 2]];
    const sq = (i: number, j: number) => {
      const dx = landmarks[i].x - landmarks[j].x, dy = landmarks[i].y - landmarks[j].y;
      return dx * dx + dy * dy;
    };
    if (sq(a, b) < MAX_EDGE_SQ && sq(b, c) < MAX_EDGE_SQ && sq(a, c) < MAX_EDGE_SQ) {
      validIdx.push(a, b, c);
    }
  }

  const displacements = mode === 'drift' && previousLandmarks
    ? computeDisplacements(landmarks, previousLandmarks) : null;
  const maxDisp = displacements ? Math.max(...displacements, 0.0001) : 0;

  const colors = new Float32Array(landmarks.length * 3);
  for (let i = 0; i < landmarks.length; i++) {
    let rgb: [number, number, number];
    if (mode === 'heatmap') rgb = getHeatmapColor(i, zoneConditions);
    else if (mode === 'drift' && displacements) rgb = getDriftColor(displacements[i], maxDisp);
    else rgb = [0.87, 0.76, 0.65];
    colors[i * 3] = rgb[0]; colors[i * 3 + 1] = rgb[1]; colors[i * 3 + 2] = rgb[2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(validIdx);
  geo.computeVertexNormals();
  return geo;
}

interface FaceSceneProps extends FaceMesh3DProps {
  showLabels: boolean;
}

function FaceScene({ landmarks, zoneConditions, previousLandmarks, mode, showLabels }: FaceSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const isInteracting = useRef(false);
  const displacements = useMemo(
    () => mode === 'drift' && previousLandmarks ? computeDisplacements(landmarks, previousLandmarks) : null,
    [landmarks, previousLandmarks, mode],
  );
  const maxDisp = useMemo(() => displacements ? Math.max(...displacements, 0.0001) : 0, [displacements]);

  const geometry = useMemo(
    () => buildGeometry(landmarks, zoneConditions, previousLandmarks, mode),
    [landmarks, zoneConditions, previousLandmarks, mode],
  );

  useFrame((_, delta) => {
    if (!isInteracting.current && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.18;
    }
  });

  if (!geometry) return null;

  return (
    <group ref={groupRef}>
      {/* Solid mesh */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.55}
          metalness={0.05}
          transparent
          opacity={0.88}
        />
      </mesh>

      {/* Wireframe overlay */}
      <mesh geometry={geometry}>
        <meshBasicMaterial wireframe transparent opacity={0.07} color="#2A1F14" />
      </mesh>

      {/* Zone labels */}
      {showLabels && Object.keys(ZONE_INDICES).map(zone => {
        const centroid = getZoneCentroid(landmarks, zone);
        if (!centroid) return null;
        const labelColor = ZONE_LABEL_COLORS[zone] + '1)';
        let subText = '';
        if (mode === 'heatmap' && zoneConditions?.[zone]) {
          const { condition, confidence } = zoneConditions[zone];
          subText = `${condition.replace(/_/g, ' ')} · ${Math.round(confidence * 100)}%`;
        } else if (mode === 'drift' && displacements) {
          const avg = getZoneAvgDrift(displacements, zone);
          subText = `Δ ${(avg * 1000).toFixed(1)}`;
        }
        return (
          <Html key={zone} position={centroid} center distanceFactor={1.8} zIndexRange={[1, 10]}>
            <div style={{
              background: 'rgba(250,246,241,0.82)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${labelColor}`,
              borderRadius: 8,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 600,
              color: '#2A1F14',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              textTransform: 'capitalize',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}>
              <span style={{ color: labelColor.replace('1)', '0.9)') }}>●</span>
              {' '}{zone}
              {subText && <div style={{ fontWeight: 400, fontSize: 9, color: '#6B5742', marginTop: 1 }}>{subText}</div>}
            </div>
          </Html>
        );
      })}

      <OrbitControls
        enablePan={false}
        minDistance={1.2}
        maxDistance={4.5}
        dampingFactor={0.08}
        enableDamping
        onStart={() => { isInteracting.current = true; }}
        onEnd={() => { setTimeout(() => { isInteracting.current = false; }, 2000); }}
      />
    </group>
  );
}

function EmptyState() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.6, 24, 24]} />
        <meshStandardMaterial color="#C9963E" transparent opacity={0.06} wireframe />
      </mesh>
    </group>
  );
}

export default function FaceMesh3D(props: FaceMesh3DProps) {
  const hasData = props.landmarks?.length > 0;
  const showLabels = props.mode !== 'clean';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0.05, 2.2], fov: 42 }}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false }}
        style={{ background: 'transparent' }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} color="#FFF8F0" />
        <directionalLight position={[-2, -1, 1]} intensity={0.35} color="#E8C490" />
        <directionalLight position={[0, -3, -2]} intensity={0.2} color="#C9963E" />

        {hasData
          ? <FaceScene {...props} showLabels={showLabels} />
          : <EmptyState />
        }
      </Canvas>

      {!hasData && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', textAlign: 'center', maxWidth: 200 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⬡</div>
            No 3D geometry captured yet.
            <br />Run a <strong style={{ color: 'var(--gold)' }}>webcam scan</strong> to build your face mesh.
          </div>
        </div>
      )}
    </div>
  );
}
