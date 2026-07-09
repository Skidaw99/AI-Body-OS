import * as THREE from "three";
import type { VisionHit } from "../store";

const raycaster = new THREE.Raycaster();
raycaster.far = 12; // meters, matches a plausible camera sensor range

/**
 * Casts a real ray from the head position along the torso's forward
 * vector against the actual scene graph. Returns genuine intersection
 * distances — not synthetic/random values.
 */
export function castVision(
  scene: THREE.Object3D,
  originWorld: THREE.Vector3,
  forwardWorld: THREE.Vector3,
  taggedObjects: THREE.Object3D[]
): VisionHit[] {
  raycaster.set(originWorld, forwardWorld.clone().normalize());
  const intersections = raycaster.intersectObjects(taggedObjects, true);

  const seen = new Set<string>();
  const hits: VisionHit[] = [];

  for (const hit of intersections) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj && !obj.userData?.sensorId) obj = obj.parent;
    if (!obj) continue;
    const id = obj.userData.sensorId as string;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push({
      object_id: id,
      label: obj.userData.label ?? id,
      distance_m: Math.round(hit.distance * 100) / 100,
    });
  }
  return hits;
}
