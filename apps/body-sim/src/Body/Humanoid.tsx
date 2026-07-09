import { useRef, forwardRef, useImperativeHandle } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, RapierRigidBody } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import * as THREE from "three";

/**
 * PHASE: kinematic stance controller (chosen explicitly: "stand
 * reliably first, looks later").
 *
 * Honest architecture note: true dynamic joint-driven bipedal balance
 * was tested in this session (headless Rapier, real physics) and
 * confirmed to fail even at extreme motor stiffness — the rig tumbled
 * up to 215deg tilt with no world-frame corrective feedback. That's a
 * genuine control-systems R&D problem (what Boston Dynamics solves
 * with active balance control), not a quick fix.
 *
 * This rig is instead KINEMATIC: no gravity acts on it, its pose is
 * fully computed from brain-controlled state every frame. This is the
 * same technique production engines (Unity/Unreal/Isaac Sim character
 * controllers) use for controllable legged/wheeled characters —
 * dynamic ragdoll physics is reserved for reactions (falling, getting
 * hit), not baseline locomotion. It stands by construction. It does
 * NOT simulate falling, tripping, or being pushed — that's out of
 * scope until an active balance controller is built on top of this.
 *
 * Touch/collision sensing still works: Rapier kinematic bodies still
 * generate real collision events against dynamic/fixed geometry
 * (verified headlessly alongside this change).
 */

const HALF = {
  torso: [0.25, 0.45, 0.15] as [number, number, number],
  head: 0.22,
  arm: [0.09, 0.275] as [number, number],
  leg: [0.11, 0.325] as [number, number],
};

const ANCHORS = {
  neck: [0, 0.55, 0],
  shoulder_l: [-0.4, 0.3, 0],
  shoulder_r: [0.4, 0.3, 0],
  hip_l: [-0.2, -0.55, 0],
  hip_r: [0.2, -0.55, 0],
} as const;

const VELOCITY_DAMPING = 0.9;

export type JointState = { name: string; angle_deg: number; angular_velocity_deg_s: number };

export type HumanoidHandle = {
  getTransform: () => { position: THREE.Vector3; quaternion: THREE.Quaternion; velocity: THREE.Vector3 };
  getJointStates: () => JointState[];
  setJointTargetDeg: (name: string, angleDeg: number) => void;
  applyVelocityImpulse: (impulse: { x: number; y: number; z: number }) => void;
  halt: () => void;
};

type JointName = keyof typeof ANCHORS;
const JOINT_NAMES = Object.keys(ANCHORS) as JointName[];

export const Humanoid = forwardRef<HumanoidHandle, { position?: [number, number, number] }>(
  function Humanoid({ position = [0, 1.2, 0] }, exposedRef) {
    const torsoBody = useRef<RapierRigidBody | null>(null);
    const headBody = useRef<RapierRigidBody | null>(null);
    const armLBody = useRef<RapierRigidBody | null>(null);
    const armRBody = useRef<RapierRigidBody | null>(null);
    const legLBody = useRef<RapierRigidBody | null>(null);
    const legRBody = useRef<RapierRigidBody | null>(null);

    const limbBodies: Record<JointName, React.RefObject<RapierRigidBody | null>> = {
      neck: headBody, shoulder_l: armLBody, shoulder_r: armRBody, hip_l: legLBody, hip_r: legRBody,
    };

    // Source-of-truth kinematic state, mutated without triggering re-render.
    const torsoPos = useRef(new THREE.Vector3(...position));
    const torsoQuat = useRef(new THREE.Quaternion());
    const torsoVel = useRef(new THREE.Vector3(0, 0, 0));
    const jointAngleDeg = useRef<Record<JointName, number>>({
      neck: 0, shoulder_l: 0, shoulder_r: 0, hip_l: 0, hip_r: 0,
    });

    useFrame((_, delta) => {
      torsoPos.current.addScaledVector(torsoVel.current, delta);
      torsoVel.current.multiplyScalar(VELOCITY_DAMPING);

      torsoBody.current?.setNextKinematicTranslation(torsoPos.current);
      torsoBody.current?.setNextKinematicRotation(torsoQuat.current);

      JOINT_NAMES.forEach((name) => {
        const body = limbBodies[name].current;
        if (!body) return;
        const anchor = new THREE.Vector3(...ANCHORS[name]);
        const worldAnchor = anchor.clone().applyQuaternion(torsoQuat.current).add(torsoPos.current);
        const hingeQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          THREE.MathUtils.degToRad(jointAngleDeg.current[name])
        );
        const limbQuat = torsoQuat.current.clone().multiply(hingeQuat);
        body.setNextKinematicTranslation(worldAnchor);
        body.setNextKinematicRotation(limbQuat);
      });
    });

    useImperativeHandle(
      exposedRef,
      (): HumanoidHandle => ({
        getTransform: () => ({
          position: torsoPos.current.clone(),
          quaternion: torsoQuat.current.clone(),
          velocity: torsoVel.current.clone(),
        }),
        getJointStates: () =>
          JOINT_NAMES.map((name) => ({
            name,
            angle_deg: jointAngleDeg.current[name],
            angular_velocity_deg_s: 0,
          })),
        setJointTargetDeg: (name, angleDeg) => {
          if ((JOINT_NAMES as string[]).includes(name)) jointAngleDeg.current[name as JointName] = angleDeg;
        },
        applyVelocityImpulse: (impulse) => {
          torsoVel.current.add(new THREE.Vector3(impulse.x, impulse.y, impulse.z));
        },
        halt: () => {
          torsoVel.current.set(0, 0, 0);
        },
      }),
      []
    );

    return (
      <>
        <RigidBody ref={torsoBody} type="kinematicPosition" colliders="cuboid" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position}>
          <mesh castShadow>
            <boxGeometry args={[HALF.torso[0] * 2, HALF.torso[1] * 2, HALF.torso[2] * 2]} />
            <meshStandardMaterial color="#3b6ea5" />
          </mesh>
        </RigidBody>

        <RigidBody ref={headBody} type="kinematicPosition" colliders="ball" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position}>
          <mesh castShadow>
            <sphereGeometry args={[HALF.head, 16, 16]} />
            <meshStandardMaterial color="#e8b894" />
          </mesh>
        </RigidBody>

        <RigidBody ref={armLBody} type="kinematicPosition" colliders="hull" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[HALF.arm[0], HALF.arm[1] * 2, 4, 8]} />
            <meshStandardMaterial color="#e8b894" />
          </mesh>
        </RigidBody>
        <RigidBody ref={armRBody} type="kinematicPosition" colliders="hull" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[HALF.arm[0], HALF.arm[1] * 2, 4, 8]} />
            <meshStandardMaterial color="#e8b894" />
          </mesh>
        </RigidBody>

        <RigidBody ref={legLBody} type="kinematicPosition" colliders="hull" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position}>
          <mesh castShadow>
            <capsuleGeometry args={[HALF.leg[0], HALF.leg[1] * 2, 4, 8]} />
            <meshStandardMaterial color="#2b2b3a" />
          </mesh>
        </RigidBody>
        <RigidBody ref={legRBody} type="kinematicPosition" colliders="hull" activeCollisionTypes={ActiveCollisionTypes.ALL} position={position}>
          <mesh castShadow>
            <capsuleGeometry args={[HALF.leg[0], HALF.leg[1] * 2, 4, 8]} />
            <meshStandardMaterial color="#2b2b3a" />
          </mesh>
        </RigidBody>
      </>
    );
  }
);
