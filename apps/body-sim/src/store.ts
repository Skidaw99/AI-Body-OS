import { create } from "zustand";

export type VisionHit = { object_id: string; label: string; distance_m: number };
export type TouchEvent = { body_part: string; object_id: string; impact_force_n: number };
export type SmellReading = { object_id: string; label: string; voc_ppm: number; distance_m: number };
export type JointState = { name: string; angle_deg: number; angular_velocity_deg_s: number };
export type BalanceState = {
  com: { x: number; y: number; z: number };
  capturePoint: { x: number; z: number };
  support: { minX: number; maxX: number; minZ: number; maxZ: number };
  zmpTarget: { x: number; z: number };
  cpMarginM: number;
  cpInsideSupport: boolean;
  tiltDeg: number;
  controllerEnabled: boolean;
};

export type Decision = {
  source: "rule_engine" | "claude" | "cached";
  goal: string;
  reasoning: string;
  actions: { joint: string; kind: string; target_angle_deg?: number }[];
  emotional_state: string;
};

export type MemoryEntry = { id: number; timestamp: string; kind: string; content: string };

interface BodyOSState {
  connected: boolean;
  tick: number;
  vision: VisionHit[];
  touch: TouchEvent[];
  smell: SmellReading[];
  joints: JointState[];
  tiltDeg: number;
  balance: BalanceState | null;
  lastDecision: Decision | null;
  memoryStream: MemoryEntry[];
  logs: string[];

  setConnected: (v: boolean) => void;
  incrementTick: () => void;
  setSensors: (p: Partial<Pick<BodyOSState, "vision" | "touch" | "smell" | "joints" | "tiltDeg" | "balance">>) => void;
  setDecision: (d: Decision) => void;
  setMemoryStream: (m: MemoryEntry[]) => void;
  pushLog: (line: string) => void;
}

export const useBodyOS = create<BodyOSState>((set) => ({
  connected: false,
  tick: 0,
  vision: [],
  touch: [],
  smell: [],
  joints: [],
  tiltDeg: 0,
  balance: null,
  lastDecision: null,
  memoryStream: [],
  logs: [],

  setConnected: (v) => set({ connected: v }),
  incrementTick: () => set((s) => ({ tick: s.tick + 1 })),
  setSensors: (p) => set(p),
  setDecision: (d) => set({ lastDecision: d }),
  setMemoryStream: (m) => set({ memoryStream: m }),
  pushLog: (line) =>
    set((s) => ({ logs: [...s.logs.slice(-199), `${new Date().toLocaleTimeString()} ${line}`] })),
}));
