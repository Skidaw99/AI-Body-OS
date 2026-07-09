import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init();

const G = 9.81;
const DT = 1 / 120;
const LIGHT_PUSH_NS = 120;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function tiltDeg(q) {
  const up = rotate(q, { x: 0, y: 1, z: 0 });
  return Math.acos(clamp(up.y, -1, 1)) * 180 / Math.PI;
}

const LOCAL_FOOT_CORNERS = [
  [-0.32, -0.84, -0.34],
  [-0.32, -0.84, 0.34],
  [0.0, -0.84, -0.34],
  [0.0, -0.84, 0.34],
  [0.0, -0.84, -0.34],
  [0.0, -0.84, 0.34],
  [0.32, -0.84, -0.34],
  [0.32, -0.84, 0.34],
];

function supportPolygon(body) {
  const q = body.rotation();
  const t = body.translation();
  const points = LOCAL_FOOT_CORNERS.map(([x, y, z]) => add(t, rotate(q, { x, y, z })));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}

function margin(point, support) {
  return Math.min(
    point.x - support.minX,
    support.maxX - point.x,
    point.z - support.minZ,
    support.maxZ - point.z,
  );
}

function addCollider(world, body, desc, offset) {
  world.createCollider(desc.setTranslation(...offset).setFriction(1.3).setRestitution(0), body);
}

function createBody(world) {
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.06, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.05, 10).setFriction(1.35), ground);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.0, 0)
      .setCanSleep(false)
      .setLinearDamping(0.08)
      .setAngularDamping(0.18),
  );
  body.setAdditionalSolverIterations(12);

  // Same dynamic compound geometry as Humanoid.tsx.
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.22, 0.55, 0.12).setDensity(650), [0, 0.35, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.16, 0.16, 0.16).setDensity(300), [0, 0.95, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.08, 0.35, 0.08).setDensity(300), [-0.42, 0.25, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.08, 0.35, 0.08).setDensity(300), [0.42, 0.25, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.12, 0.4, 0.09).setDensity(500), [-0.16, -0.35, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.12, 0.4, 0.09).setDensity(500), [0.16, -0.35, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.16, 0.055, 0.34).setDensity(900), [-0.16, -0.78, 0]);
  addCollider(world, body, RAPIER.ColliderDesc.cuboid(0.16, 0.055, 0.34).setDensity(900), [0.16, -0.78, 0]);
  body.recomputeMassPropertiesFromColliders();
  return body;
}

function capturePointControl(body) {
  const com = body.worldCom();
  const velocity = body.linvel();
  const q = body.rotation();
  const av = body.angvel();
  const massKg = Math.max(1, body.mass());
  const support = supportPolygon(body);
  const center = { x: (support.minX + support.maxX) / 2, z: (support.minZ + support.maxZ) / 2 };
  const omega = Math.sqrt(G / Math.max(0.4, com.y));
  const cp = { x: com.x + velocity.x / omega, z: com.z + velocity.z / omega };

  // LIPM / Capture Point law: xi_dot = omega * (xi - zmp).
  // Put ZMP beyond xi in the error direction, then clamp to the real support polygon.
  const gain = 1.0;
  const supportMarginM = 0.04;
  const zmp = {
    x: clamp(cp.x + gain * (cp.x - center.x), support.minX + supportMarginM, support.maxX - supportMarginM),
    z: clamp(cp.z + gain * (cp.z - center.z), support.minZ + supportMarginM, support.maxZ - supportMarginM),
  };

  const desiredAcc = {
    x: clamp(omega * omega * (com.x - zmp.x), -4.5, 4.5),
    z: clamp(omega * omega * (com.z - zmp.z), -4.5, 4.5),
  };

  body.addForce({ x: massKg * desiredAcc.x, y: 0, z: massKg * desiredAcc.z }, true);

  // Bounded trunk stabilizer that maintains the upright-LIPM assumption.
  // Balance authority still comes from the Capture Point/ZMP calculation above.
  const up = rotate(q, { x: 0, y: 1, z: 0 });
  body.addTorque({
    x: 220 * up.z - 50 * av.x,
    y: -15 * av.y,
    z: -220 * up.x - 50 * av.z,
  }, true);

  return {
    com,
    velocity,
    cp,
    support,
    zmp,
    cpMarginM: margin(cp, support),
    tilt: tiltDeg(q),
  };
}

function runScenario() {
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 12;
  const body = createBody(world);
  const mass = body.mass();

  let minCpMargin = Infinity;
  let maxTilt = 0;
  let finalMetrics = null;

  console.log(`Dynamic stance body mass=${mass.toFixed(2)}kg, push=${LIGHT_PUSH_NS}Ns at upper torso, dt=${DT.toFixed(5)}s`);
  console.log("Columns: t, COM(x,z), CapturePoint(x,z), support polygon, cp_margin_m, tilt_deg");

  for (let step = 0; step <= 8 / DT; step += 1) {
    if (step === Math.round(1 / DT)) {
      body.applyImpulseAtPoint({ x: LIGHT_PUSH_NS, y: 0, z: 0 }, { x: 0, y: 1.65, z: 0 }, true);
      console.log(`DISTURBANCE: upper-body impulse ${LIGHT_PUSH_NS} Ns at t=1.00s`);
    }

    const metrics = capturePointControl(body);
    world.step();

    minCpMargin = Math.min(minCpMargin, metrics.cpMarginM);
    maxTilt = Math.max(maxTilt, metrics.tilt);
    finalMetrics = metrics;

    if (step % Math.round(0.5 / DT) === 0) {
      console.log(
        `t=${(step * DT).toFixed(2)} ` +
        `COM=(${metrics.com.x.toFixed(3)},${metrics.com.z.toFixed(3)}) ` +
        `CP=(${metrics.cp.x.toFixed(3)},${metrics.cp.z.toFixed(3)}) ` +
        `support=x[${metrics.support.minX.toFixed(2)},${metrics.support.maxX.toFixed(2)}] ` +
        `z[${metrics.support.minZ.toFixed(2)},${metrics.support.maxZ.toFixed(2)}] ` +
        `cp_margin=${metrics.cpMarginM.toFixed(3)} ` +
        `tilt=${metrics.tilt.toFixed(2)}`,
      );
    }
  }

  const finalTilt = finalMetrics?.tilt ?? Infinity;
  const finalMargin = finalMetrics?.cpMarginM ?? -Infinity;
  const pass = minCpMargin > 0.05 && maxTilt < 5 && finalTilt < 2 && finalMargin > 0.2;

  console.log("\nSUMMARY");
  console.log(`min_cp_margin_m=${minCpMargin.toFixed(3)}`);
  console.log(`max_tilt_deg=${maxTilt.toFixed(3)}`);
  console.log(`final_cp_margin_m=${finalMargin.toFixed(3)}`);
  console.log(`final_tilt_deg=${finalTilt.toFixed(3)}`);
  console.log(`RESULT: ${pass ? "PASS — dynamic Capture Point balance remained inside support polygon" : "FAIL — balance criteria not met"}`);

  if (!pass) process.exitCode = 1;
}

runScenario();
