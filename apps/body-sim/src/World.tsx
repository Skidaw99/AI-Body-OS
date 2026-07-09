import { useRef, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { Humanoid, HumanoidHandle } from "./Body/Humanoid";
import { castVision } from "./Sensors/VisionSensor";
import { computeSmell } from "./Sensors/SmellSensor";
import { connectBrain, sendSensorSnapshot } from "./ws/client";
import { useBodyOS } from "./store";

const TICK_HZ = 10; // sensor snapshot rate sent to the brain (not the physics rate)

type VOCSource = { id: string; label: string; position: [number, number, number]; strength: number };

const VOC_SOURCES: VOCSource[] = [
  { id: "trash_bin", label: "trash bin", position: [3, 0.3, -2], strength: 40 },
  { id: "flower_pot", label: "flowers", position: [-2.5, 0.3, 1.5], strength: 8 },
];

function TaggedBox({ id, label, position, color, size = [0.6, 0.6, 0.6] }: {
  id: string; label: string; position: [number, number, number]; color: string; size?: [number, number, number];
}) {
  return (
    <RigidBody type="fixed" colliders="cuboid" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position} userData={{ sensorId: id, label }}>
      <mesh castShadow receiveShadow userData={{ sensorId: id, label }}>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
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

    const taggedObjects = scene.children.filter((c) => c.userData?.sensorId);
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
      <RigidBody type="fixed" activeCollisionTypes={ActiveCollisionTypes.ALL} onCollisionEnter={(e) => {
        const other = e.other.rigidBodyObject;
        if (!other) return;
        const relVel = e.other.rigidBody?.linvel();
        const speed = relVel ? Math.sqrt(relVel.x ** 2 + relVel.y ** 2 + relVel.z ** 2) : 0;
        registerTouch("body", other.userData?.sensorId ?? "unknown", speed * 40); // mass-scaled estimate
      }}>
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#1c2230" />
        </mesh>
      </RigidBody>

      {VOC_SOURCES.map((v) => (
        <TaggedBox key={v.id} id={v.id} label={v.label} position={v.position} color={v.id === "trash_bin" ? "#5a4a2a" : "#c65a9e"} />
      ))}
      <TaggedBox id="wall_n" label="wall" position={[0, 1.5, -8]} color="#3a3f4d" size={[10, 3, 0.3]} />
      <TaggedBox id="crate" label="crate" position={[1.5, 0.4, -3]} color="#8a6d3b" size={[0.8, 0.8, 0.8]} />

      <Humanoid ref={humanoidRef} position={[0, 1.0, 3]} />
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
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />
      <Physics gravity={[0, -9.81, 0]}>
        <SceneLoop />
      </Physics>
    </Canvas>
  );
}
