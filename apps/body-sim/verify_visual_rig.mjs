/**
 * Headless verification of the visual layer (no browser needed):
 *
 * 1. public/android.glb parses with the real GLTFLoader
 * 2. it contains a true SkinnedMesh (skinned vertices, not loose meshes)
 * 3. the skeleton exposes exactly the physics joint names from
 *    Humanoid.tsx: root, neck, shoulder_l, shoulder_r, hip_l, hip_r
 * 4. bone rest positions match the physics ANCHORS
 * 5. rotating a joint bone actually deforms skinned vertices — i.e. the
 *    skinning is live, and vertices far from the joint stay put
 *
 * Run: node verify_visual_rig.mjs   (exit code 0 = pass)
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// root-local anchors matching the dynamic body's collider layout
// (see Humanoid.tsx / tools/generate_android_glb.mjs)
const ANCHORS = {
  neck: [0, 0.79, 0],
  shoulder_l: [-0.42, 0.6, 0],
  shoulder_r: [0.42, 0.6, 0],
  hip_l: [-0.16, 0.05, 0],
  hip_r: [0.16, 0.05, 0],
  ankle_l: [-0.16, -0.725, 0],
  ankle_r: [0.16, -0.725, 0],
};
// ankles are children of the hips, so their bone-local rest position is
// relative to the hip anchor
const BONE_PARENT = { ankle_l: "hip_l", ankle_r: "hip_r" };

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const glbPath = join(dirname(fileURLToPath(import.meta.url)), "public", "android.glb");
const buffer = readFileSync(glbPath);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
});

// GLTFLoader expands multi-material geometry into one SkinnedMesh per
// primitive, all sharing the same skeleton and full attribute buffers.
const skinnedMeshes = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) skinnedMeshes.push(o);
});
const skinned = skinnedMeshes[0] ?? null;

check("GLB parses and contains a SkinnedMesh", !!skinned, `${skinnedMeshes.length} skinned primitives`);
if (!skinned) process.exit(1);

const geo = skinned.geometry;
check(
  "geometry has per-vertex skinIndex + skinWeight",
  !!geo.attributes.skinIndex && !!geo.attributes.skinWeight,
  `${geo.attributes.position.count} vertices`
);

const boneNames = skinned.skeleton.bones.map((b) => b.name).sort();
const expected = ["ankle_l", "ankle_r", "hip_l", "hip_r", "neck", "root", "shoulder_l", "shoulder_r"];
check(
  "skeleton bones exactly match the virtual joint names",
  JSON.stringify(boneNames) === JSON.stringify(expected),
  boneNames.join(", ")
);

for (const [name, [x, y, z]] of Object.entries(ANCHORS)) {
  const bone = skinned.skeleton.bones.find((b) => b.name === name);
  const parent = BONE_PARENT[name];
  const [px, py, pz] = parent ? ANCHORS[parent] : [0, 0, 0];
  const ex = x - px, ey = y - py, ez = z - pz; // expected bone-local position
  const p = bone.position;
  const ok = bone && Math.abs(p.x - ex) < 1e-4 && Math.abs(p.y - ey) < 1e-4 && Math.abs(p.z - ez) < 1e-4;
  check(`bone '${name}' rest position matches rig anchor`, ok, `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  if (parent) {
    check(`bone '${name}' is a child of '${parent}'`, bone.parent?.name === parent, `parent=${bone.parent?.name}`);
  }
}

// multiple materials incl. an emissive one (light-lines) must survive export
const mats = [...new Set(skinnedMeshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])))];
const hasEmissive = mats.some((m) => m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.5);
check("PBR materials present incl. emissive accent material", mats.length >= 2 && hasEmissive, `${mats.length} materials: ${mats.map((m) => m.name).join(", ")}`);

// --- live skinning test: rotate shoulder_l 90°, vertices must move -------
// (attribute buffers are shared across primitives, so testing the first
// mesh over its full position buffer covers the whole model)
gltf.scene.updateMatrixWorld(true);
skinned.skeleton.update();

const count = geo.attributes.position.count;
const before = [];
const v = new THREE.Vector3();
for (let i = 0; i < count; i++) {
  before.push(skinned.applyBoneTransform(i, v.fromBufferAttribute(geo.attributes.position, i)).clone());
}

const shoulder = skinned.skeleton.bones.find((b) => b.name === "shoulder_l");
shoulder.rotation.x = Math.PI / 2; // same hinge axis Humanoid.tsx drives
gltf.scene.updateMatrixWorld(true);
skinned.skeleton.update();

let moved = 0;
let movedFar = 0; // vertices >5cm displaced
let torsoMoved = 0;
const skinIndexAttr = geo.attributes.skinIndex;
const skinWeightAttr = geo.attributes.skinWeight;
for (let i = 0; i < count; i++) {
  const after = skinned.applyBoneTransform(i, v.fromBufferAttribute(geo.attributes.position, i));
  const d = after.distanceTo(before[i]);
  if (d > 1e-6) moved++;
  if (d > 0.05) movedFar++;
  // a vertex fully weighted to root (torso shell) must NOT move
  const w0 = skinWeightAttr.getX(i);
  const idx0 = skinIndexAttr.getX(i);
  const isPureRoot = w0 > 0.999 && skinned.skeleton.bones[idx0].name === "root";
  if (isPureRoot && d > 1e-6) torsoMoved++;
}

check("rotating shoulder_l deforms skinned vertices", moved > 0 && movedFar > 100, `${moved} moved, ${movedFar} moved >5cm`);
check("torso vertices (root-weighted) stay put", torsoMoved === 0, `${torsoMoved} unexpectedly moved`);

console.log(failures === 0 ? "\nRESULT: VISUAL RIG VERIFIED" : `\nRESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
