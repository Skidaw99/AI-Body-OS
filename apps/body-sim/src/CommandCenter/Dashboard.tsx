import { useEffect, useState } from "react";
import { useBodyOS } from "../store";
import { fetchMemory } from "../ws/client";

const panelStyle: React.CSSProperties = {
  background: "#12161f",
  border: "1px solid #232838",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#d8dee9",
  fontSize: 13,
  fontFamily: "ui-monospace, monospace",
  overflowY: "auto",
};

export default function Dashboard() {
  const connected = useBodyOS((s) => s.connected);
  const tick = useBodyOS((s) => s.tick);
  const vision = useBodyOS((s) => s.vision);
  const touch = useBodyOS((s) => s.touch);
  const smell = useBodyOS((s) => s.smell);
  const joints = useBodyOS((s) => s.joints);
  const tiltDeg = useBodyOS((s) => s.tiltDeg);
  const balance = useBodyOS((s) => s.balance);
  const decision = useBodyOS((s) => s.lastDecision);
  const logs = useBodyOS((s) => s.logs);

  const [memory, setMemory] = useState<any[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchMemory(30).then(setMemory).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 380,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        boxSizing: "border-box",
        background: "#0a0e14",
        borderLeft: "1px solid #232838",
      }}
    >
      <div style={{ ...panelStyle, display: "flex", justifyContent: "space-between" }}>
        <span>tick #{tick}</span>
        <span style={{ color: connected ? "#5ad17e" : "#e05a5a" }}>{connected ? "● brain connected" : "○ disconnected"}</span>
      </div>

      <div style={panelStyle}>
        <div style={{ color: "#8a93a8", marginBottom: 4 }}>CURRENT GOAL / STATE</div>
        {decision ? (
          <>
            <div>goal: <b>{decision.goal}</b></div>
            <div>source: {decision.source}</div>
            <div>emotion: {decision.emotional_state}</div>
            <div style={{ marginTop: 4, color: "#a8b2c4" }}>{decision.reasoning}</div>
          </>
        ) : (
          <div style={{ color: "#5a6478" }}>waiting for first decision…</div>
        )}
      </div>

      <div style={{ ...panelStyle, maxHeight: 190 }}>
        <div style={{ color: "#8a93a8", marginBottom: 4 }}>SENSORS / BALANCE</div>
        <div>tilt: {tiltDeg.toFixed(1)}°</div>
        <div>vision: {vision.length ? vision.map((v) => `${v.label}@${v.distance_m}m`).join(", ") : "clear"}</div>
        <div>touch: {touch.length ? touch.map((t) => `${t.body_part}<-${t.object_id}(${t.impact_force_n.toFixed(0)}N)`).join(", ") : "none"}</div>
        <div>smell: {smell.length ? smell.map((s) => `${s.label}:${s.voc_ppm}ppm`).join(", ") : "none"}</div>
        <div>joints: {joints.length ? joints.map((j) => `${j.name}:${j.angle_deg.toFixed(0)}°`).join(", ") : "n/a"}</div>
        {balance && (
          <div style={{ marginTop: 6 }}>
            <div>COM: x={balance.com.x.toFixed(3)} z={balance.com.z.toFixed(3)}</div>
            <div>Capture Point: x={balance.capturePoint.x.toFixed(3)} z={balance.capturePoint.z.toFixed(3)}</div>
            <div>CP margin: {balance.cpMarginM.toFixed(3)}m {balance.cpInsideSupport ? "inside" : "outside"}</div>
            <div>Support: x[{balance.support.minX.toFixed(2)}, {balance.support.maxX.toFixed(2)}] z[{balance.support.minZ.toFixed(2)}, {balance.support.maxZ.toFixed(2)}]</div>
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, flex: 1 }}>
        <div style={{ color: "#8a93a8", marginBottom: 4 }}>MEMORY STREAM</div>
        {memory.length === 0 && <div style={{ color: "#5a6478" }}>no memory yet</div>}
        {memory.map((m) => (
          <div key={m.id} style={{ marginBottom: 3 }}>
            <span style={{ color: "#5a6478" }}>[{m.kind}]</span> {m.content}
          </div>
        ))}
      </div>

      <div style={{ ...panelStyle, height: 140 }}>
        <div style={{ color: "#8a93a8", marginBottom: 4 }}>LOGS</div>
        {logs.slice(-30).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
