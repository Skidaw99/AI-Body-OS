/**
 * Headless verification of the vision-sensor pipeline (no browser).
 * Bundles the REAL src/Sensors code with esbuild and runs it against a
 * scene graph shaped exactly like the runtime one:
 *
 *   scene > group (SceneLoop) > rigidbody-group [sensorId]
 *         > visual group [sensorId] > meshes
 *
 * Proves two things:
 * 1. THE OLD BUG: collecting tagged objects with `scene.children.filter`
 *    finds NOTHING once props are nested in a group — vision reads
 *    "clear" forever while looking straight at a wall (silent sensor
 *    failure, the exact class of bug this project was bitten by twice).
 * 2. THE FIX: collectTaggedObjects() + castVision() see the wall/crate
 *    at genuine raycast distances, and nested visual meshes resolve to
 *    the right object ids without duplicates.
 *
 * Run: node verify_sensors_headless.mjs   (exit code 0 = pass)
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// bundle inside the project so Node can resolve the external 'three'
// import against ./node_modules
const tmp = mkdtempSync(join(here, "node_modules", ".sensor-verify-"));

// bundle the real sensor sources (three stays external, Node resolves it)
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  `export { castVision } from ${JSON.stringify(join(here, "src/Sensors/VisionSensor.ts").replace(/\\/g, "/"))};
export { collectTaggedObjects } from ${JSON.stringify(join(here, "src/Sensors/collectTagged.ts").replace(/\\/g, "/"))};`
);
const bundle = join(tmp, "sensors.mjs");
execSync(
  `"${join(here, "node_modules/.bin/esbuild")}" "${entry}" --bundle --format=esm --platform=node --external:three --outfile="${bundle}"`,
  { stdio: "inherit" }
);

const THREE = await import("three");
const { castVision, collectTaggedObjects } = await import(pathToFileURL(bundle).href);

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// --- build a runtime-shaped scene -----------------------------------------
function makeTaggedProp(id, label, position, size) {
  const rb = new THREE.Group(); // stand-in for the RigidBody wrapper group
  rb.userData = { sensorId: id, label };
  rb.position.set(...position);
  const visual = new THREE.Group(); // inner visual group, also tagged
  visual.userData = { sensorId: id, label };
  // several nested meshes, like the futuristic prop visuals
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0] * (1 - i * 0.2), size[1] * (1 - i * 0.2), size[2]));
    visual.add(mesh);
  }
  rb.add(visual);
  rb.updateMatrixWorld(true);
  return rb;
}

const scene = new THREE.Scene();
const sceneLoopGroup = new THREE.Group(); // <group> returned by SceneLoop
scene.add(sceneLoopGroup);

sceneLoopGroup.add(makeTaggedProp("wall_n", "wall", [0, 1.5, -8], [10, 3, 0.3]));
sceneLoopGroup.add(makeTaggedProp("crate", "crate", [1.5, 0.4, -3], [0.8, 0.8, 0.8]));
sceneLoopGroup.add(makeTaggedProp("trash_bin", "trash bin", [3, 0.3, -2], [0.6, 0.6, 0.6]));
scene.updateMatrixWorld(true);

// --- 1. demonstrate the old bug -------------------------------------------
const oldCollection = scene.children.filter((c) => c.userData?.sensorId);
check(
  "OLD collection (scene.children.filter) misses nested props (the bug)",
  oldCollection.length === 0,
  `found ${oldCollection.length} — vision would read "clear" forever`
);

// --- 2. the fix finds them, topmost only ----------------------------------
const tagged = collectTaggedObjects(scene);
check("collectTaggedObjects finds all 3 props", tagged.length === 3, tagged.map((t) => t.userData.sensorId).join(", "));
const topmostOnly = tagged.every((t) => !t.parent?.userData?.sensorId);
check("collection contains only topmost tagged nodes (no double raycasts)", topmostOnly);

// --- 3. real raycast through castVision ------------------------------------
// humanoid head at [0, 1.8, 3] looking -Z (the runtime home pose)
const head = new THREE.Vector3(0, 1.8, 3);
const forward = new THREE.Vector3(0, 0, -1);
const hits = castVision(scene, head, forward, tagged);

const wallHit = hits.find((h) => h.object_id === "wall_n");
// wall front face: z = -8 + 0.15 => 10.85m from head at z=3
check("vision sees the wall through nested visual meshes", !!wallHit, wallHit ? `${wallHit.label}@${wallHit.distance_m}m` : "no hit");
check(
  "wall distance is the genuine raycast distance (~10.85m)",
  !!wallHit && Math.abs(wallHit.distance_m - 10.85) < 0.05,
  wallHit ? `${wallHit.distance_m}m` : ""
);
check("no duplicate ids in hits", new Set(hits.map((h) => h.object_id)).size === hits.length, hits.map((h) => h.object_id).join(", "));

// looking toward the crate: from head to crate center
const toCrate = new THREE.Vector3(1.5, 0.4, -3).sub(head).normalize();
const crateHits = castVision(scene, head, toCrate, tagged);
check("vision sees the crate when looking at it", crateHits.some((h) => h.object_id === "crate"),
  crateHits.map((h) => `${h.object_id}@${h.distance_m}m`).join(", "));

rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nRESULT: SENSOR PIPELINE VERIFIED" : `\nRESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
