/**
 * Procedurally generates the rigged android GLB used as the visual layer
 * on top of the dynamic stance body (see src/Body/Humanoid.tsx).
 *
 * License/provenance: the model is generated entirely by this script —
 * no external assets, textures, or downloaded meshes. Public domain.
 *
 * Rig contract (must stay in sync with Humanoid.tsx):
 *   - bone names == the virtual joint names: neck, shoulder_l/r,
 *     hip_l/r, ankle_l/r (plus "root" for the body root)
 *   - bone rest positions match the collider layout of the dynamic body:
 *       torso column  x±0.22 y -0.20..0.90 z±0.12
 *       head          center (0, 0.95, 0) r~0.16
 *       arms          x ±0.42, y -0.10..0.60 (hanging down)
 *       legs          x ±0.16, y -0.75..0.05
 *       feet          center y -0.78 (half 0.055), z ±0.34
 *   - bones have identity rest rotation, so bone.rotation.x = the brain's
 *     virtual joint angle, same convention the physics-era hinge used
 *   - the GLB root is mounted as a child of the dynamic RigidBody, so
 *     root position/tilt come from real physics, not from this rig
 *
 * Run: node tools/generate_android_glb.mjs  -> public/android.glb
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// GLTFExporter's binary path uses FileReader (browser API). Minimal shim.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
}

// ---- rig contract (root-local anchors, mirrors Humanoid.tsx colliders) ---
const ANCHORS = {
  neck: [0, 0.79, 0],
  shoulder_l: [-0.42, 0.6, 0],
  shoulder_r: [0.42, 0.6, 0],
  hip_l: [-0.16, 0.05, 0],
  hip_r: [0.16, 0.05, 0],
  ankle_l: [-0.16, -0.725, 0],
  ankle_r: [0.16, -0.725, 0],
};
// ankles are children of the matching hip in the bone hierarchy
const BONE_PARENT = { ankle_l: "hip_l", ankle_r: "hip_r" };
const BONE_ORDER = ["root", "neck", "shoulder_l", "shoulder_r", "hip_l", "hip_r", "ankle_l", "ankle_r"];
const BONE_INDEX = Object.fromEntries(BONE_ORDER.map((n, i) => [n, i]));

// ---- materials -----------------------------------------------------------
const MAT_BODY = new THREE.MeshStandardMaterial({
  name: "android_body",
  color: 0x9aa3b2, // brushed gunmetal
  metalness: 0.85,
  roughness: 0.35,
});
const MAT_DARK = new THREE.MeshStandardMaterial({
  name: "android_joint",
  color: 0x1b1f2a, // matte carbon joints
  metalness: 0.6,
  roughness: 0.7,
});
const MAT_GLOW = new THREE.MeshStandardMaterial({
  name: "android_glow",
  color: 0x061014,
  emissive: 0x36e0ff, // cyan light-lines
  emissiveIntensity: 2.2,
  metalness: 0.2,
  roughness: 0.4,
});
const MATERIALS = [MAT_BODY, MAT_DARK, MAT_GLOW];
const M_BODY = 0, M_DARK = 1, M_GLOW = 2;

// ---- geometry assembly ---------------------------------------------------
// Each part: geometry authored in bone-local space, translated to the
// bone's root-local anchor before skin binding. `blend` gives a soft
// skin-weight falloff to root near the joint anchor so limbs deform
// smoothly instead of moving as detached rigid chunks.
const parts = [];

function addPart(geometry, materialIndex, bone, opts = {}) {
  parts.push({ geometry, materialIndex, bone, ...opts });
}

function xform(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale)
  );
  geo.applyMatrix4(m);
  return geo;
}

// --- torso column: tapered lathe shell, elliptical cross-section ----------
// covers the main collider (x±0.22, y -0.20..0.90, z±0.12)
{
  const profile = [
    [0.0, -0.2], [0.12, -0.19], [0.155, -0.05], [0.14, 0.18],
    [0.135, 0.36], [0.17, 0.55], [0.19, 0.72], [0.165, 0.82],
    [0.10, 0.88], [0.0, 0.895],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.LatheGeometry(profile, 24);
  xform(torso, { scale: [1.18, 1, 0.63] });
  addPart(torso, M_BODY, "root");

  // pelvis block bridging the hip pods
  const pelvis = new THREE.SphereGeometry(0.17, 18, 12);
  xform(pelvis, { scale: [1.35, 0.75, 0.72], pos: [0, -0.14, 0] });
  addPart(pelvis, M_DARK, "root");

  // chest core (reactor disc)
  const core = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20);
  xform(core, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.62, 0.125] });
  addPart(core, M_GLOW, "root");
  const coreRim = new THREE.TorusGeometry(0.065, 0.011, 8, 24);
  xform(coreRim, { pos: [0, 0.62, 0.125] });
  addPart(coreRim, M_DARK, "root");

  // spine light-line (front center)
  const spine = new THREE.BoxGeometry(0.015, 0.5, 0.012);
  xform(spine, { pos: [0, 0.28, 0.145], rot: [0.06, 0, 0] });
  addPart(spine, M_GLOW, "root");

  // waist band
  const waist = new THREE.CylinderGeometry(0.148, 0.156, 0.05, 20);
  xform(waist, { scale: [1.18, 1, 0.63], pos: [0, 0.03, 0] });
  addPart(waist, M_DARK, "root");

  // collar ring
  const collar = new THREE.TorusGeometry(0.1, 0.018, 8, 20);
  xform(collar, { rot: [Math.PI / 2, 0, 0], scale: [1.18, 1, 0.75], pos: [0, 0.855, 0] });
  addPart(collar, M_DARK, "root");
}

// --- head: helmet + visor, skinned to `neck` ------------------------------
// head collider center = (0, 0.95, 0) root-local = (0, 0.16, 0) bone-local
{
  const b = "neck";
  const helmet = new THREE.SphereGeometry(0.175, 24, 18);
  xform(helmet, { scale: [0.9, 1.06, 0.95], pos: [0, 0.17, 0] });
  addPart(helmet, M_BODY, b, { blend: { radius: 0.1 } });

  // visor: forward-facing partial torus band (forward = -Z in this project)
  const visor = new THREE.TorusGeometry(0.14, 0.025, 10, 24, Math.PI * 0.9);
  xform(visor, {
    rot: [0, Math.PI + Math.PI * 0.45, 0],
    scale: [1, 0.55, 1],
    pos: [0, 0.18, 0],
  });
  addPart(visor, M_GLOW, b);

  // chin guard
  const chin = new THREE.SphereGeometry(0.105, 16, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  xform(chin, { scale: [1.2, 1.1, 1.2], pos: [0, 0.13, 0] });
  addPart(chin, M_DARK, b);

  // ear pods
  for (const s of [-1, 1]) {
    const pod = new THREE.CylinderGeometry(0.045, 0.045, 0.028, 14);
    xform(pod, { rot: [0, 0, Math.PI / 2], pos: [s * 0.16, 0.18, 0] });
    addPart(pod, M_DARK, b);
    const podGlow = new THREE.CylinderGeometry(0.02, 0.02, 0.032, 12);
    xform(podGlow, { rot: [0, 0, Math.PI / 2], pos: [s * 0.165, 0.18, 0] });
    addPart(podGlow, M_GLOW, b);
  }
}

// --- arms: hanging down from the shoulders --------------------------------
// arm collider: x ±0.42, y 0.25 ± 0.35 root-local => bone-local 0..-0.70
// shoulder rotation.x swings the whole arm forward/back.
function buildArm(boneName, sign) {
  const b = boneName;
  const blend = { radius: 0.13 };

  const pod = new THREE.SphereGeometry(0.095, 18, 14);
  xform(pod, { scale: [1.15, 0.95, 0.95] });
  addPart(pod, M_BODY, b, { blend });

  const upper = new THREE.CylinderGeometry(0.06, 0.07, 0.3, 14);
  xform(upper, { pos: [0, -0.19, 0] });
  addPart(upper, M_BODY, b, { blend });

  const upperGlow = new THREE.BoxGeometry(0.012, 0.24, 0.012);
  xform(upperGlow, { pos: [sign * 0.052, -0.19, 0.038] });
  addPart(upperGlow, M_GLOW, b);

  const elbow = new THREE.SphereGeometry(0.062, 14, 12);
  xform(elbow, { pos: [0, -0.37, 0] });
  addPart(elbow, M_DARK, b);

  const forearm = new THREE.CylinderGeometry(0.045, 0.058, 0.26, 12);
  xform(forearm, { pos: [0, -0.52, 0] });
  addPart(forearm, M_BODY, b);

  const hand = new THREE.SphereGeometry(0.052, 12, 10);
  xform(hand, { scale: [0.85, 1.25, 0.9], pos: [0, -0.68, 0] });
  addPart(hand, M_DARK, b);

  const palm = new THREE.SphereGeometry(0.024, 10, 8);
  xform(palm, { pos: [0, -0.7, sign * 0.0 - 0.03] });
  addPart(palm, M_GLOW, b);
}

buildArm("shoulder_l", -1);
buildArm("shoulder_r", 1);

// --- legs: hip pod + thigh + knee + shin down to the ankle -----------------
// leg collider: x ±0.16, y -0.35 ± 0.40 root-local => bone-local 0..-0.775
function buildLeg(boneName) {
  const b = boneName;
  const blend = { radius: 0.13 };

  const pod = new THREE.SphereGeometry(0.105, 18, 14);
  xform(pod, { scale: [1, 0.9, 1] });
  addPart(pod, M_BODY, b, { blend });

  const thigh = new THREE.CylinderGeometry(0.082, 0.098, 0.32, 14);
  xform(thigh, { pos: [0, -0.19, 0] });
  addPart(thigh, M_BODY, b, { blend });

  const thighGlow = new THREE.BoxGeometry(0.012, 0.26, 0.012);
  xform(thighGlow, { pos: [0.065, -0.19, 0.042] });
  addPart(thighGlow, M_GLOW, b);

  const knee = new THREE.SphereGeometry(0.078, 14, 12);
  xform(knee, { pos: [0, -0.38, 0] });
  addPart(knee, M_DARK, b);

  const shin = new THREE.CylinderGeometry(0.058, 0.075, 0.33, 12);
  xform(shin, { pos: [0, -0.565, 0] });
  addPart(shin, M_BODY, b);

  const shinGlow = new THREE.BoxGeometry(0.01, 0.26, 0.01);
  xform(shinGlow, { pos: [0, -0.56, 0.055] });
  addPart(shinGlow, M_GLOW, b);
}

buildLeg("hip_l");
buildLeg("hip_r");

// --- feet: boots on the ankle bones ----------------------------------------
// foot collider: center y -0.78 root-local (half 0.055), z ±0.34
// => bone-local y 0..-0.11; toe points forward (-Z)
function buildFoot(boneName) {
  const b = boneName;

  const ankleJoint = new THREE.SphereGeometry(0.06, 14, 12);
  xform(ankleJoint, { pos: [0, -0.01, 0] });
  addPart(ankleJoint, M_DARK, b);

  // main boot body, longer toward -Z (forward)
  const boot = new THREE.BoxGeometry(0.28, 0.09, 0.6);
  xform(boot, { pos: [0, -0.062, -0.03] });
  addPart(boot, M_BODY, b);

  // toe cap
  const toe = new THREE.CylinderGeometry(0.14, 0.14, 0.088, 14, 1, false, 0, Math.PI);
  xform(toe, { rot: [0, -Math.PI / 2, 0], scale: [1, 1, 0.9], pos: [0, -0.062, -0.33] });
  addPart(toe, M_DARK, b);

  // heel cap
  const heel = new THREE.CylinderGeometry(0.13, 0.13, 0.088, 14, 1, false, 0, Math.PI);
  xform(heel, { rot: [0, Math.PI / 2, 0], scale: [1, 1, 0.9], pos: [0, -0.062, 0.27] });
  addPart(heel, M_DARK, b);

  // glowing toe strip + ankle ring
  const strip = new THREE.BoxGeometry(0.2, 0.016, 0.02);
  xform(strip, { pos: [0, -0.05, -0.315] });
  addPart(strip, M_GLOW, b);

  const ring = new THREE.TorusGeometry(0.062, 0.012, 8, 20);
  xform(ring, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.015, 0] });
  addPart(ring, M_GLOW, b);
}

buildFoot("ankle_l");
buildFoot("ankle_r");

// ---- skinning ------------------------------------------------------------
// Every vertex gets bone weights. Limb parts weight to their bone with an
// optional smooth blend toward root near the anchor (distance-based), so
// the mesh is one continuous skinned body, not detached rigid chunks.
const merged = [];
for (const part of parts) {
  const geo = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
  const count = geo.attributes.position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const boneIdx = BONE_INDEX[part.bone];
  const anchor = part.bone === "root" ? null : new THREE.Vector3(...ANCHORS[part.bone]);
  const v = new THREE.Vector3();

  // limb geometry is authored in bone-local space (origin = anchor):
  // move it to root-local rest position now, after transforms above.
  if (anchor) geo.translate(anchor.x, anchor.y, anchor.z);

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(geo.attributes.position, i);
    let wLimb = 1;
    if (anchor && part.blend) {
      const d = v.distanceTo(anchor);
      // inside blend radius: share weight with root for smooth deformation
      wLimb = THREE.MathUtils.clamp(0.5 + (0.5 * d) / part.blend.radius, 0.5, 1);
    }
    skinIndex[i * 4 + 0] = boneIdx;
    skinIndex[i * 4 + 1] = BONE_INDEX.root;
    skinWeight[i * 4 + 0] = anchor ? wLimb : 1;
    skinWeight[i * 4 + 1] = anchor ? 1 - wLimb : 0;
  }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geo.userData.materialIndex = part.materialIndex;
  merged.push(geo);
}

// merge with groups so each part keeps its material
const geometry = mergeGeometries(merged, true);
if (!geometry) throw new Error("mergeGeometries failed");
geometry.groups.forEach((g, i) => (g.materialIndex = merged[i].userData.materialIndex));
const finalGeo = geometry;

// ---- skeleton ------------------------------------------------------------
// hierarchy: root > (neck, shoulders, hips); hips > ankles. Bone LOCAL
// positions are therefore relative to the parent bone.
const bones = BONE_ORDER.map((name) => {
  const bone = new THREE.Bone();
  bone.name = name;
  return bone;
});
const byName = Object.fromEntries(BONE_ORDER.map((n, i) => [n, bones[i]]));
for (const name of BONE_ORDER.slice(1)) {
  const parentName = BONE_PARENT[name] ?? "root";
  const parentAnchor = parentName === "root" ? [0, 0, 0] : ANCHORS[parentName];
  const a = ANCHORS[name];
  byName[name].position.set(a[0] - parentAnchor[0], a[1] - parentAnchor[1], a[2] - parentAnchor[2]);
  byName[parentName].add(byName[name]);
}

const mesh = new THREE.SkinnedMesh(finalGeo, MATERIALS);
mesh.name = "android";
mesh.add(byName.root);
// bone inverses are computed from world matrices — update them first
mesh.updateMatrixWorld(true);
mesh.bind(new THREE.Skeleton(bones));
mesh.frustumCulled = false;

const scene = new THREE.Scene();
scene.name = "android_scene";
scene.add(mesh);
scene.updateMatrixWorld(true);

// ---- export --------------------------------------------------------------
const exporter = new GLTFExporter();
exporter.parse(
  scene,
  (glb) => {
    const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "android.glb");
    writeFileSync(outPath, Buffer.from(glb));
    const kb = (glb.byteLength / 1024).toFixed(1);
    console.log(`Wrote ${outPath} (${kb} KB, ${finalGeo.attributes.position.count} verts, bones: ${BONE_ORDER.join(", ")})`);
  },
  (err) => {
    console.error("GLTF export failed:", err);
    process.exit(1);
  },
  { binary: true }
);
