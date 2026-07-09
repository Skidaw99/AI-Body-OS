import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

// Fixed wall
const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, -3));
const wallCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1, 0.15), wallBody);

// Kinematic torso, same setup as Humanoid.tsx (kinematicPosition)
const torsoBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 3)
);
const torsoCollider = world.createCollider(
  RAPIER.ColliderDesc.cuboid(0.25, 0.45, 0.15)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
  torsoBody
);
// wall also needs active events flag for the pair to report
wallCollider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

let collisionFired = false;
const eventQueue = new RAPIER.EventQueue(true);

// Move torso toward the wall over time (same as a kinematic character controller)
const dt = 1 / 60;
world.timestep = dt;

for (let step = 0; step < 60 * 5; step++) {
  const t = torsoBody.translation();
  // move -z toward wall at 1.5 m/s
  torsoBody.setNextKinematicTranslation({ x: t.x, y: t.y, z: t.z - 1.5 * dt });
  world.step(eventQueue);

  eventQueue.drainCollisionEvents((h1, h2, started) => {
    if (started) collisionFired = true;
  });

  if (collisionFired) {
    console.log(`Collision detected at step ${step}, t=${(step * dt).toFixed(2)}s, torso z=${torsoBody.translation().z.toFixed(2)}`);
    break;
  }
}

console.log("RESULT:", collisionFired ? "KINEMATIC COLLISION EVENTS WORK" : "NO COLLISION EVENT FIRED (touch sensor would be broken)");
