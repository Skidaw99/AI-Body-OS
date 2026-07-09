import * as THREE from "three";

export type SupportPolygon = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type CapturePointMetrics = {
  com: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  capturePoint: { x: number; z: number };
  support: SupportPolygon;
  supportCenter: { x: number; z: number };
  zmpTarget: { x: number; z: number };
  cpMarginM: number;
  cpInsideSupport: boolean;
  omega: number;
  desiredAcceleration: { x: number; z: number };
};

export type CapturePointControl = {
  metrics: CapturePointMetrics;
  force: { x: number; y: number; z: number };
  torque: { x: number; y: number; z: number };
};

export type CapturePointControllerConfig = {
  gravity: number;
  massKg: number;
  captureGain: number;
  maxHorizontalAcceleration: number;
  supportMarginM: number;
  postureStiffness: number;
  postureDamping: number;
};

const DEFAULT_CONFIG: Omit<CapturePointControllerConfig, "massKg"> = {
  gravity: 9.81,
  captureGain: 1.0,
  maxHorizontalAcceleration: 4.5,
  supportMarginM: 0.04,
  postureStiffness: 220,
  postureDamping: 50,
};

export const LOCAL_FOOT_CORNERS = [
  [-0.32, -0.84, -0.34],
  [-0.32, -0.84, 0.34],
  [0.0, -0.84, -0.34],
  [0.0, -0.84, 0.34],
  [0.0, -0.84, -0.34],
  [0.0, -0.84, 0.34],
  [0.32, -0.84, -0.34],
  [0.32, -0.84, 0.34],
] as const;

export function computeSupportPolygon(
  rootPosition: THREE.Vector3,
  rootQuaternion: THREE.Quaternion,
): SupportPolygon {
  const points = LOCAL_FOOT_CORNERS.map(([x, y, z]) =>
    new THREE.Vector3(x, y, z).applyQuaternion(rootQuaternion).add(rootPosition),
  );

  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}

export function supportCenter(support: SupportPolygon) {
  return {
    x: (support.minX + support.maxX) / 2,
    z: (support.minZ + support.maxZ) / 2,
  };
}

export function supportMargin(point: { x: number; z: number }, support: SupportPolygon): number {
  return Math.min(
    point.x - support.minX,
    support.maxX - point.x,
    point.z - support.minZ,
    support.maxZ - point.z,
  );
}

export function pointInsideSupport(point: { x: number; z: number }, support: SupportPolygon): boolean {
  return supportMargin(point, support) >= 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function computeCapturePointControl(args: {
  com: THREE.Vector3;
  velocity: THREE.Vector3;
  rootPosition: THREE.Vector3;
  rootQuaternion: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  config: Partial<CapturePointControllerConfig> & { massKg: number };
}): CapturePointControl {
  const config: CapturePointControllerConfig = { ...DEFAULT_CONFIG, ...args.config };
  const support = computeSupportPolygon(args.rootPosition, args.rootQuaternion);
  const center = supportCenter(support);
  const heightM = Math.max(0.4, args.com.y);
  const omega = Math.sqrt(config.gravity / heightM);

  const capturePoint = {
    x: args.com.x + args.velocity.x / omega,
    z: args.com.z + args.velocity.z / omega,
  };

  // Capture Point / ZMP law:
  //   xi_dot = omega * (xi - zmp)
  // To pull xi back to the support center, command zmp beyond xi in the
  // direction of the current xi error, then clamp it to the actual foot polygon.
  const desiredZmp = {
    x: capturePoint.x + config.captureGain * (capturePoint.x - center.x),
    z: capturePoint.z + config.captureGain * (capturePoint.z - center.z),
  };

  const zmpTarget = {
    x: clamp(desiredZmp.x, support.minX + config.supportMarginM, support.maxX - config.supportMarginM),
    z: clamp(desiredZmp.z, support.minZ + config.supportMarginM, support.maxZ - config.supportMarginM),
  };

  const desiredAcceleration = {
    x: clamp(omega * omega * (args.com.x - zmpTarget.x), -config.maxHorizontalAcceleration, config.maxHorizontalAcceleration),
    z: clamp(omega * omega * (args.com.z - zmpTarget.z), -config.maxHorizontalAcceleration, config.maxHorizontalAcceleration),
  };

  const force = {
    x: config.massKg * desiredAcceleration.x,
    y: 0,
    z: config.massKg * desiredAcceleration.z,
  };

  // Upright trunk torque keeps the rigid body inside the LIPM assumption.
  // This is not the balance law itself; it is a bounded posture stabilizer.
  const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(args.rootQuaternion);
  const torque = {
    x: config.postureStiffness * bodyUp.z - config.postureDamping * args.angularVelocity.x,
    y: -config.postureDamping * 0.3 * args.angularVelocity.y,
    z: -config.postureStiffness * bodyUp.x - config.postureDamping * args.angularVelocity.z,
  };

  const cpMarginM = supportMargin(capturePoint, support);

  return {
    metrics: {
      com: { x: args.com.x, y: args.com.y, z: args.com.z },
      velocity: { x: args.velocity.x, y: args.velocity.y, z: args.velocity.z },
      capturePoint,
      support,
      supportCenter: center,
      zmpTarget,
      cpMarginM,
      cpInsideSupport: cpMarginM >= 0,
      omega,
      desiredAcceleration,
    },
    force,
    torque,
  };
}

export function tiltDegreesFromQuaternion(q: THREE.Quaternion): number {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
}
