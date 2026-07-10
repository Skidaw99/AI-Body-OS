import * as THREE from "three";

/**
 * Collects sensor-tagged objects wherever they live in the scene graph.
 * The previous implementation (`scene.children.filter`) only looked at
 * direct children of the scene root — but the tagged RigidBodies are
 * nested inside the SceneLoop <group>, so it returned nothing and vision
 * silently read "clear" forever. traverse() finds them at any depth;
 * the topmost-filter avoids raycasting the same subtree twice (both the
 * RigidBody wrapper and its inner visual group carry the sensorId).
 * Covered headlessly by verify_sensors_headless.mjs.
 */
export function collectTaggedObjects(scene: THREE.Object3D): THREE.Object3D[] {
  const tagged: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData?.sensorId) tagged.push(o);
  });
  return tagged.filter((o) => {
    let p = o.parent;
    while (p) {
      if (p.userData?.sensorId) return false;
      p = p.parent;
    }
    return true;
  });
}
