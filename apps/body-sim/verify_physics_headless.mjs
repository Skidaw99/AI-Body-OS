// Headless verification of the humanoid rig + stance motors, using the
// exact same Rapier physics engine the browser uses (WASM, no GPU
// needed). This replicates Humanoid.tsx's joint anchors/axes and the
// SceneLoop's motor config so the result is representative, not a
// separate toy model.
import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const STANCE_STIFFNESS = 2000;
const STANCE_DAMPING = 200;

function makeBody(pos, halfExtentsOrRadius, mass, isCapsule = false, isBall = false) {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
  const body = world.createRigidBody(bodyDesc);
  let colliderDesc;
  if (isBall) colliderDesc = RAPIER.ColliderDesc.ball(halfExtentsOrRadius);
  else if (isCapsule) colliderDesc = RAPIER.ColliderDesc.capsule(halfExtentsOrRadius[0], halfExtentsOrRadius[1]);
  else colliderDesc = RAPIER.ColliderDesc.cuboid(...halfExtentsOrRadius);
  colliderDesc.setMass(mass).setFriction(0.8).setRestitution(0.05);
  world.createCollider(colliderDesc, body);
  return body;
}

// Ground
const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
const ground = world.createRigidBody(groundDesc);
world.createCollider(RAPIER.ColliderDesc.cuboid(15, 0.1, 15), ground);

// Torso at same start height/position pattern as World.tsx (group at y=1.2)
const base = { x: 0, y: 1.2, z: 3 };
const torso = makeBody(base, [0.25, 0.45, 0.15], 8);
const head = makeBody({ x: base.x, y: base.y + 0.75, z: base.z }, 0.22, 1.2, false, true);
const armL = makeBody({ x: base.x - 0.4, y: base.y, z: base.z }, [0.09, 0.275], 1.5, true);
const armR = makeBody({ x: base.x + 0.4, y: base.y, z: base.z }, [0.09, 0.275], 1.5, true);
const legL = makeBody({ x: base.x - 0.2, y: base.y - 0.9, z: base.z }, [0.11, 0.325], 2.5, true);
const legR = makeBody({ x: base.x + 0.2, y: base.y - 0.9, z: base.z }, [0.11, 0.325], 2.5, true);

function revolute(body1, body2, anchor1, anchor2) {
  const params = RAPIER.JointData.revolute(
    { x: anchor1[0], y: anchor1[1], z: anchor1[2] },
    { x: anchor2[0], y: anchor2[1], z: anchor2[2] },
    { x: 1, y: 0, z: 0 }
  );
  const joint = world.createImpulseJoint(params, body1, body2, true);
  joint.configureMotorPosition(0, STANCE_STIFFNESS, STANCE_DAMPING);
  return joint;
}

const hipL = revolute(torso, legL, [-0.2, -0.55, 0], [0, 0.35, 0]);
const hipR = revolute(torso, legR, [0.2, -0.55, 0], [0, 0.35, 0]);
revolute(torso, head, [0, 0.55, 0], [0, -0.15, 0]);
revolute(torso, armL, [-0.4, 0.3, 0], [0, 0.3, 0]);
revolute(torso, armR, [0.4, 0.3, 0], [0, 0.3, 0]);

function tiltDeg(body) {
  const r = body.rotation();
  // same euler XYZ approximation used in World.tsx
  const q = { x: r.x, y: r.y, z: r.z, w: r.w };
  // extract approx euler X and Z via standard formulas
  const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
  const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const eulerX = Math.atan2(sinr_cosp, cosr_cosp);
  const sinz = 2 * (q.w * q.z - q.y * q.x);
  const eulerZ = Math.abs(sinz) >= 1 ? Math.sign(sinz) * Math.PI / 2 : Math.asin(sinz);
  return (Math.abs(eulerX) + Math.abs(eulerZ)) * (180 / Math.PI);
}

const dt = 1 / 60;
world.timestep = dt;

console.log("t=0.0s  tilt=" + tiltDeg(torso).toFixed(1) + "deg  y=" + torso.translation().y.toFixed(2));

for (let step = 1; step <= 60 * 8; step++) {
  world.step();
  if (step % 60 === 0) {
    const t = (step * dt).toFixed(1);
    console.log(`t=${t}s  tilt=${tiltDeg(torso).toFixed(1)}deg  y=${torso.translation().y.toFixed(2)}`);
  }
}

const finalTilt = tiltDeg(torso);
console.log("\nFINAL tilt:", finalTilt.toFixed(1), "deg");
console.log("RESULT:", finalTilt < 35 ? "STANDS (within safety threshold)" : "FALLS OVER (exceeds 35deg threshold)");
