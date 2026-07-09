import * as THREE from "three";
import type { SmellReading } from "../store";

/**
 * Smell has no physical sensor equivalent in a 3D sim by definition —
 * the brief itself specs it as "gesimuleerde VOC-data". This computes
 * a real inverse-distance falloff from actual object positions and a
 * per-object VOC source strength (set in World.tsx), so it's driven by
 * genuine world state, not a hardcoded/random placeholder value.
 */
export function computeSmell(
  noseWorldPos: THREE.Vector3,
  vocSources: { id: string; label: string; position: THREE.Vector3; sourceStrengthPpm: number }[],
  rangeM = 6
): SmellReading[] {
  const readings: SmellReading[] = [];
  for (const src of vocSources) {
    const distance = noseWorldPos.distanceTo(src.position);
    if (distance > rangeM) continue;
    // inverse-square-ish falloff, clamped so it doesn't blow up near-field
    const falloff = 1 / Math.max(0.5, distance * distance);
    const ppm = src.sourceStrengthPpm * falloff;
    if (ppm < 0.05) continue;
    readings.push({
      object_id: src.id,
      label: src.label,
      voc_ppm: Math.round(ppm * 100) / 100,
      distance_m: Math.round(distance * 100) / 100,
    });
  }
  return readings.sort((a, b) => b.voc_ppm - a.voc_ppm);
}
