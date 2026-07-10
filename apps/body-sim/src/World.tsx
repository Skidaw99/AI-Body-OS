import { useRef, useEffect, useCallback, ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { Humanoid, HumanoidHandle } from "./Body/Humanoid";
import { castVision } from "./Sensors/VisionSensor";
import { computeSmell } from "./Sensors/SmellSensor";
import { collectTaggedObjects } from "./Sensors/collectTagged";
import { connectBrain, sendSensorSnapshot } from "./ws/client";
import { useBodyOS } from "./store";
import {
  Atmosphere,
  FloorSkin,
  Perimeter,
  TrashBinVisual,
  PlanterVisual,
  SciFiWallVisual,
  CargoCrateVisual,
} from "./Environment";

const TICK_HZ = 10; // sensor snapshot rate sent to the brain (not the physics rate)

type VOCSource = { id: string; label: string; position: [number, number, number]; strength: number };

const VOC_SOURCES: VOCSource[] = [
  { id: "trash_bin", label: "trash bin", position: [3, 0.3, -2], strength: 40 },
  { id: "flower_pot", label: "flowers", position: [-2.5, 0.3, 1.5], strength: 8 },
];

/**
 * Sensor-tagged prop: the collider half-extents are pinned to the exact
 * values the old auto-generated cuboid colliders had (size/2), so the
 * touch/vision sensor behavior is unchanged while the visuals are free
 * to be actual set-dressing instead of colored boxes.
 */
function TaggedProp({ id, label, position, colliderHalf, children }: {
  id: string; label: string; position: [number, number, number];
  colliderHalf: [number, number, number]; children: ReactNode;
}) {
  return (
    <RigidBody type="fixed" colliders={false} activeCollisionTypes={ActiveCollisionTypes.ALL} position={position} userData={{ sensorId: id, label }}>
      <CuboidCollider args={colliderHalf} />
      <group userData={{ sensorId: id, label }}>{children}</group>
    </RigidBody>
  );
}

function SceneLoop() {
  const { scene } = useThree();
  const humanoidRef = useRef<HumanoidHandle | null>(null);
  const tickAccum = useRef(0);
  const tickCount = useRef(0);
  const touchBuffer = useRef<{ body_part: string; object_id: string; impact_force_n: number }[]>([]);

  const setSensors = useBodyOS((s) => s.setSensors);
  const setDecision = useBodyOS((s) => s.setDecision);
  const incrementTick = useBodyOS((s) => s.incrementTick);

  useEffect(() => {
    connectBrain();
  }, []);

  const registerTouch = useCallback((bodyPart: string, objectId: string, impactForce: number) => {
    touchBuffer.current.push({ body_part: bodyPart, object_id: objectId, impact_force_n: impactForce });
  }, []);

  useFrame((_, delta) => {
    tickAccum.current += delta;
    if (tickAccum.current < 1 / TICK_HZ) return;
    tickAccum.current = 0;

    const handle = humanoidRef.current;
    if (!handle) return;

    const { position: torsoPosVec, quaternion: quat, velocity: velVec } = handle.getTransform();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const balance = handle.getBalanceSnapshot();
    const tiltDeg = balance?.tiltDeg ?? 0;

    const taggedObjects = collectTaggedObjects(scene);
    const headWorld = torsoPosVec.clone().add(new THREE.Vector3(0, 0.6, 0));

    const vision = castVision(scene, headWorld, forward, taggedObjects);
    const smell = computeSmell(
      headWorld,
      VOC_SOURCES.map((v) => ({ id: v.id, label: v.label, position: new THREE.Vector3(...v.position), sourceStrengthPpm: v.strength })),
    );
    const joints = handle.getJointStates();
    const touch = touchBuffer.current.splice(0, touchBuffer.current.length);

    setSensors({ vision, touch, smell, joints, tiltDeg, balance });
    tickCount.current += 1;
    incrementTick();

    sendSensorSnapshot({
      tick: tickCount.current,
      position: { x: torsoPosVec.x, y: torsoPosVec.y, z: torsoPosVec.z },
      velocity: { x: velVec.x, y: velVec.y, z: velVec.z },
      tilt_deg: tiltDeg,
      vision,
      touch,
      smell,
      joints,
    })?.then((decision) => {
      setDecision(decision);
      applyDecision(handle, decision);
    });
  });

  return (
    <group>
      {/* physics ground + touch sensor. The collider is an explicit THICK
          cuboid (top face at y=0): the old auto-collider derived from a
          flat plane mesh had ~zero thickness, and the dynamic body's small
          foot colliders sank straight through it until the torso collider
          caught — the android stood buried to its waist in the browser
          while every headless test (which models a thick ground) passed.
          The visible futuristic floor is FloorSkin, outside this body so
          it can't add unintended colliders. */}
      <RigidBody type="fixed" colliders={false} activeCollisionTypes={ActiveCollisionTypes.ALL} onCollisionEnter={(e) => {
        const other = e.other.rigidBodyObject;
        if (!other) return;
        const relVel = e.other.rigidBody?.linvel();
        const speed = relVel ? Math.sqrt(relVel.x ** 2 + relVel.y ** 2 + relVel.z ** 2) : 0;
        registerTouch("body", other.userData?.sensorId ?? "unknown", speed * 40); // mass-scaled estimate
      }}>
        <CuboidCollider args={[15, 0.25, 15]} position={[0, -0.25, 0]} friction={1.2} />
      </RigidBody>

      {/* sensor-tagged props — same ids, positions, and collider sizes as
          the original primitive boxes */}
      <TaggedProp id="trash_bin" label="trash bin" position={[3, 0.3, -2]} colliderHalf={[0.3, 0.3, 0.3]}>
        <TrashBinVisual />
      </TaggedProp>
      <TaggedProp id="flower_pot" label="flowers" position={[-2.5, 0.3, 1.5]} colliderHalf={[0.3, 0.3, 0.3]}>
        <PlanterVisual />
      </TaggedProp>
      <TaggedProp id="wall_n" label="wall" position={[0, 1.5, -8]} colliderHalf={[5, 1.5, 0.15]}>
        <SciFiWallVisual />
      </TaggedProp>
      <TaggedProp id="crate" label="crate" position={[1.5, 0.4, -3]} colliderHalf={[0.4, 0.4, 0.4]}>
        <CargoCrateVisual />
      </TaggedProp>

      <Humanoid ref={humanoidRef} position={[0, 1.0, 3]} />

      {/* visual-only set dressing: no colliders, no sensor tags */}
      <FloorSkin />
      <Perimeter />
    </group>
  );
}

function applyDecision(humanoid: HumanoidHandle, decision: any) {
  if (!decision?.actions) return;
  for (const action of decision.actions) {
    if (action.kind === "halt") {
      humanoid.halt();
    }
    if (action.kind === "apply_impulse" && action.impulse) {
      humanoid.applyVelocityImpulse(action.impulse);
    }
    if (action.kind === "set_angle" && typeof action.target_angle_deg === "number") {
      humanoid.setJointTargetDeg(action.joint, action.target_angle_deg);
    }
  }
}

export default function World() {
  return (
    <Canvas shadows camera={{ position: [0, 3, 9], fov: 50 }}>
      <Atmosphere />
      <Physics gravity={[0, -9.81, 0]}>
        <SceneLoop />
      </Physics>
    </Canvas>
  );
}
