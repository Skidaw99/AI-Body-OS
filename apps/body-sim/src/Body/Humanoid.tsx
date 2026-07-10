import { forwardRef, useEffect, useImperativeHandle, useRef, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, RapierRigidBody } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import { useGLTF } from "@react-three/drei";
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
 *
 * VISUAL LAYER: what you SEE is public/android.glb — a procedurally
 * generated, genuinely skinned mesh (see tools/generate_android_glb.mjs,
 * verified by verify_visual_rig.mjs) whose skeleton matches this body's
 * collider layout and joint names. The GLB sits INSIDE the RigidBody, so
 * its root transform follows the dynamic physics exactly (falls/tilts and
 * all); its bones are driven every frame from the same virtual joint
 * registers that getJointStates()/setJointTargetDeg() expose to the brain.
 * Honest limitation (inherited from the compound-body design): the joints
 * are virtual — moving them animates the skin but does not move the
 * colliders, exactly as upstream's virtual joint registers moved nothing.
 * The colliders below are the physics authority and are unchanged.
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

const ANDROID_GLB = "/android.glb";

function vectorFromRapier(v: { x: number; y: number; z: number }) {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function quaternionFromRapier(q: { x: number; y: number; z: number; w: number }) {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

type AndroidVisual = {
  bones: Partial<Record<JointName, THREE.Object3D>>;
  glowMat: THREE.MeshStandardMaterial | null;
};

/** Loads the skinned GLB and hands its joint bones to the parent's frame
 *  loop. Mounted inside the RigidBody, so the physics root transform is
 *  applied by rapier itself — zero drift possible. */
function AndroidSkin({ visualRef }: { visualRef: React.MutableRefObject<AndroidVisual | null> }) {
  const gltf = useGLTF(ANDROID_GLB);

  useEffect(() => {
    let glowMat: THREE.MeshStandardMaterial | null = null;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // skinned bounds don't track bone motion
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m.name === "android_glow") glowMat = m as THREE.MeshStandardMaterial;
        }
      }
    });
    const bones: Partial<Record<JointName, THREE.Object3D>> = {};
    for (const name of JOINT_NAMES) {
      bones[name] = gltf.scene.getObjectByName(name) ?? undefined;
    }
    const missing = JOINT_NAMES.filter((n) => !bones[n]);
    if (missing.length) console.error(`android.glb is missing joint bones: ${missing.join(", ")}`);
    visualRef.current = { bones, glowMat };
    return () => {
      visualRef.current = null;
    };
  }, [gltf, visualRef]);

  return <primitive object={gltf.scene} />;
}

useGLTF.preload(ANDROID_GLB);

export const Humanoid = forwardRef<HumanoidHandle, { position?: [number, number, number]; controllerEnabled?: boolean }>(
  function Humanoid({ position = [0, 1.0, 3], controllerEnabled = true }, exposedRef) {
    const bodyRef = useRef<RapierRigidBody | null>(null);
    const latestBalance = useRef<BalanceSnapshot | null>(null);
    const visual = useRef<AndroidVisual | null>(null);
    const virtualJointTargets = useRef<Record<JointName, number>>({
      neck: 0,
      shoulder_l: 0,
      shoulder_r: 0,
      hip_l: 0,
      hip_r: 0,
      ankle_l: 0,
      ankle_r: 0,
    });

    useFrame((state) => {
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

      // Visual skeleton: bone X-rotation mirrors the virtual joint
      // registers the brain reads/writes via the handle below. The GLB
      // root itself is a child of the RigidBody, so position/tilt come
      // straight from the dynamic physics.
      const vis = visual.current;
      if (vis) {
        JOINT_NAMES.forEach((name) => {
          const bone = vis.bones[name];
          if (bone) bone.rotation.x = THREE.MathUtils.degToRad(virtualJointTargets.current[name]);
        });
        if (vis.glowMat) {
          // subtle "alive" pulse on the emissive light-lines
          vis.glowMat.emissiveIntensity = 2.1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.45;
        }
      }
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

        {/* Visible layer — skinned android; follows this dynamic body's
            transform because it is a child of it. No colliders of its own
            (colliders={false} on the body; the explicit colliders above
            are the physics authority). */}
        <Suspense fallback={null}>
          <AndroidSkin visualRef={visual} />
        </Suspense>
      </RigidBody>
    );
  },
);
