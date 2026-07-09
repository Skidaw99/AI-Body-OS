import { forwardRef, useImperativeHandle, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, RapierRigidBody } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import {
  CapturePointMetrics,
  computeCapturePointControl,
  computeSupportPolygon,
  supportMargin,
  tiltDegreesFromQuaternion,
} from "../Balance/capturePoint";

/**
 * Dynamic biped stance body.
 *
 * This is intentionally NOT kinematic: the root is a dynamic Rapier rigid
 * body with gravity, broad foot contact colliders, friction, COM tracking,
 * support-polygon calculation, and a Capture Point / LIPM controller.
 *
 * Scope boundary: this is a stance controller for standing and rejecting a
 * light disturbance. It is not a walking controller and not a hard-push
 * recovery system. The current body is a dynamic compound stance model
 * rather than a full articulated ankle/knee/hip actuator stack; that is the
 * next mechanical-control layer if/when walking is required.
 */

export type JointState = { name: string; angle_deg: number; angular_velocity_deg_s: number };

export type BalanceSnapshot = CapturePointMetrics & {
  tiltDeg: number;
  controllerEnabled: boolean;
};

export type HumanoidHandle = {
  getTransform: () => { position: THREE.Vector3; quaternion: THREE.Quaternion; velocity: THREE.Vector3 };
  getJointStates: () => JointState[];
  getBalanceSnapshot: () => BalanceSnapshot | null;
  setJointTargetDeg: (name: string, angleDeg: number) => void;
  applyVelocityImpulse: (impulse: { x: number; y: number; z: number }) => void;
  halt: () => void;
};

const JOINT_NAMES = ["neck", "shoulder_l", "shoulder_r", "hip_l", "hip_r", "ankle_l", "ankle_r"] as const;
type JointName = (typeof JOINT_NAMES)[number];

const CONTROLLER = {
  captureGain: 1.0,
  maxHorizontalAcceleration: 4.5,
  supportMarginM: 0.04,
  postureStiffness: 220,
  postureDamping: 50,
};

function vectorFromRapier(v: { x: number; y: number; z: number }) {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function quaternionFromRapier(q: { x: number; y: number; z: number; w: number }) {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

export const Humanoid = forwardRef<HumanoidHandle, { position?: [number, number, number]; controllerEnabled?: boolean }>(
  function Humanoid({ position = [0, 1.0, 3], controllerEnabled = true }, exposedRef) {
    const bodyRef = useRef<RapierRigidBody | null>(null);
    const latestBalance = useRef<BalanceSnapshot | null>(null);
    const virtualJointTargets = useRef<Record<JointName, number>>({
      neck: 0,
      shoulder_l: 0,
      shoulder_r: 0,
      hip_l: 0,
      hip_r: 0,
      ankle_l: 0,
      ankle_r: 0,
    });

    useFrame(() => {
      const body = bodyRef.current;
      if (!body) return;

      const rootPosition = vectorFromRapier(body.translation());
      const rootQuaternion = quaternionFromRapier(body.rotation());
      const velocity = vectorFromRapier(body.linvel());
      const angularVelocity = vectorFromRapier(body.angvel());
      const com = vectorFromRapier(body.worldCom());
      const massKg = Math.max(1, body.mass());

      const control = computeCapturePointControl({
        com,
        velocity,
        rootPosition,
        rootQuaternion,
        angularVelocity,
        config: { massKg, ...CONTROLLER },
      });

      if (controllerEnabled) {
        body.addForce(control.force, true);
        body.addTorque(control.torque, true);
      }

      latestBalance.current = {
        ...control.metrics,
        tiltDeg: tiltDegreesFromQuaternion(rootQuaternion),
        controllerEnabled,
      };
    });

    useImperativeHandle(
      exposedRef,
      (): HumanoidHandle => ({
        getTransform: () => {
          const body = bodyRef.current;
          if (!body) {
            return {
              position: new THREE.Vector3(...position),
              quaternion: new THREE.Quaternion(),
              velocity: new THREE.Vector3(),
            };
          }
          return {
            position: vectorFromRapier(body.translation()),
            quaternion: quaternionFromRapier(body.rotation()),
            velocity: vectorFromRapier(body.linvel()),
          };
        },
        getJointStates: () =>
          JOINT_NAMES.map((name) => ({
            name,
            angle_deg: virtualJointTargets.current[name],
            angular_velocity_deg_s: 0,
          })),
        getBalanceSnapshot: () => {
          if (latestBalance.current) return latestBalance.current;
          const body = bodyRef.current;
          if (!body) return null;
          const rootPosition = vectorFromRapier(body.translation());
          const rootQuaternion = quaternionFromRapier(body.rotation());
          const com = vectorFromRapier(body.worldCom());
          const velocity = vectorFromRapier(body.linvel());
          const support = computeSupportPolygon(rootPosition, rootQuaternion);
          const omega = Math.sqrt(9.81 / Math.max(0.4, com.y));
          const capturePoint = { x: com.x + velocity.x / omega, z: com.z + velocity.z / omega };
          const cpMarginM = supportMargin(capturePoint, support);
          return {
            com: { x: com.x, y: com.y, z: com.z },
            velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
            capturePoint,
            support,
            supportCenter: { x: (support.minX + support.maxX) / 2, z: (support.minZ + support.maxZ) / 2 },
            zmpTarget: capturePoint,
            cpMarginM,
            cpInsideSupport: cpMarginM >= 0,
            omega,
            desiredAcceleration: { x: 0, z: 0 },
            tiltDeg: tiltDegreesFromQuaternion(rootQuaternion),
            controllerEnabled,
          };
        },
        setJointTargetDeg: (name, angleDeg) => {
          if ((JOINT_NAMES as readonly string[]).includes(name)) virtualJointTargets.current[name as JointName] = angleDeg;
        },
        applyVelocityImpulse: (impulse) => {
          bodyRef.current?.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
        },
        halt: () => {
          bodyRef.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
          bodyRef.current?.setAngvel({ x: 0, y: 0, z: 0 }, true);
        },
      }),
      [controllerEnabled, position],
    );

    return (
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        position={position}
        canSleep={false}
        linearDamping={0.08}
        angularDamping={0.18}
        additionalSolverIterations={12}
      >
        {/* Physical colliders: broad feet are real contact surfaces, not visual-only meshes. */}
        <CuboidCollider args={[0.22, 0.55, 0.12]} position={[0, 0.35, 0]} friction={1.3} density={650} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.16, 0.16, 0.16]} position={[0, 0.95, 0]} friction={1.0} density={300} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.08, 0.35, 0.08]} position={[-0.42, 0.25, 0]} friction={1.0} density={300} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.08, 0.35, 0.08]} position={[0.42, 0.25, 0]} friction={1.0} density={300} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.12, 0.4, 0.09]} position={[-0.16, -0.35, 0]} friction={1.1} density={500} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.12, 0.4, 0.09]} position={[0.16, -0.35, 0]} friction={1.1} density={500} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.16, 0.055, 0.34]} position={[-0.16, -0.78, 0]} friction={1.35} density={900} activeCollisionTypes={ActiveCollisionTypes.ALL} />
        <CuboidCollider args={[0.16, 0.055, 0.34]} position={[0.16, -0.78, 0]} friction={1.35} density={900} activeCollisionTypes={ActiveCollisionTypes.ALL} />

        {/* Visual body follows the same dynamic root; these are not physics authority. */}
        <mesh castShadow position={[0, 0.35, 0]}>
          <boxGeometry args={[0.44, 1.1, 0.24]} />
          <meshStandardMaterial color="#3b6ea5" />
        </mesh>
        <mesh castShadow position={[0, 0.95, 0]}>
          <boxGeometry args={[0.32, 0.32, 0.32]} />
          <meshStandardMaterial color="#e8b894" />
        </mesh>
        <mesh castShadow position={[-0.42, 0.25, 0]}>
          <boxGeometry args={[0.16, 0.7, 0.16]} />
          <meshStandardMaterial color="#e8b894" />
        </mesh>
        <mesh castShadow position={[0.42, 0.25, 0]}>
          <boxGeometry args={[0.16, 0.7, 0.16]} />
          <meshStandardMaterial color="#e8b894" />
        </mesh>
        <mesh castShadow position={[-0.16, -0.35, 0]}>
          <boxGeometry args={[0.24, 0.8, 0.18]} />
          <meshStandardMaterial color="#2b2b3a" />
        </mesh>
        <mesh castShadow position={[0.16, -0.35, 0]}>
          <boxGeometry args={[0.24, 0.8, 0.18]} />
          <meshStandardMaterial color="#2b2b3a" />
        </mesh>
        <mesh castShadow position={[-0.16, -0.78, 0]}>
          <boxGeometry args={[0.32, 0.11, 0.68]} />
          <meshStandardMaterial color="#111722" />
        </mesh>
        <mesh castShadow position={[0.16, -0.78, 0]}>
          <boxGeometry args={[0.32, 0.11, 0.68]} />
          <meshStandardMaterial color="#111722" />
        </mesh>
      </RigidBody>
    );
  },
);
