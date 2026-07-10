import { useEffect, useState } from "react";
import { useBodyOS } from "../store";
import { fetchMemory } from "../ws/client";

/**
 * Command Center — visual theme only; every value shown is bound to the
 * same live store/API data as before (sensor snapshots, decisions,
 * memory readback). No decorative fake data.
 */

const CYAN = "#36e0ff";
const AMBER = "#ffb64d";

const panelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(16, 22, 34, 0.92), rgba(10, 14, 22, 0.92))",
  border: "1px solid rgba(54, 224, 255, 0.18)",
  borderRadius: 6,
  padding: "10px 12px",
  color: "#d8dee9",
  fontSize: 13,
  fontFamily: "ui-monospace, monospace",
  overflowY: "auto",
  boxShadow: "inset 0 0 12px rgba(54, 224, 255, 0.04)",
};

const headerStyle: React.CSSProperties = {
  color: CYAN,
  marginBottom: 6,
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  opacity: 0.9,
};

const labelStyle: React.CSSProperties = { color: "#6b7690" };

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
        background: "rgba(5, 8, 14, 0.92)",
        borderLeft: `1px solid rgba(54, 224, 255, 0.25)`,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ ...panelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: CYAN, letterSpacing: "0.14em", fontSize: 12 }}>AI BODY OS ▸ COMMAND CENTER</span>
        <span style={{ color: "#6b7690", fontSize: 11 }}>tick #{tick}</span>
      </div>

      <div style={{ ...panelStyle, display: "flex", justifyContent: "space-between" }}>
        <span style={labelStyle}>brain link</span>
        <span style={{ color: connected ? "#5ad17e" : "#e05a5a", textShadow: connected ? "0 0 8px rgba(90, 209, 126, 0.6)" : "none" }}>
          {connected ? "● ONLINE" : "○ OFFLINE"}
        </span>
      </div>

      <div style={panelStyle}>
        <div style={headerStyle}>Current Goal / State</div>
        {decision ? (
          <>
            <div>goal: <b style={{ color: CYAN }}>{decision.goal}</b></div>
            <div><span style={labelStyle}>source:</span> {decision.source}</div>
            <div><span style={labelStyle}>emotion:</span> <span style={{ color: AMBER }}>{decision.emotional_state}</span></div>
            <div style={{ marginTop: 4, color: "#a8b2c4" }}>{decision.reasoning}</div>
          </>
        ) : (
          <div style={{ color: "#5a6478" }}>waiting for first decision…</div>
        )}
      </div>

      <div style={{ ...panelStyle, maxHeight: 210 }}>
        <div style={headerStyle}>Sensors / Balance</div>
        <div><span style={labelStyle}>tilt:</span> {tiltDeg.toFixed(1)}°</div>
        <div><span style={labelStyle}>vision:</span> {vision.length ? vision.map((v) => `${v.label}@${v.distance_m}m`).join(", ") : "clear"}</div>
        <div><span style={labelStyle}>touch:</span> {touch.length ? touch.map((t) => `${t.body_part}<-${t.object_id}(${t.impact_force_n.toFixed(0)}N)`).join(", ") : "none"}</div>
        <div><span style={labelStyle}>smell:</span> {smell.length ? smell.map((s) => `${s.label}:${s.voc_ppm}ppm`).join(", ") : "none"}</div>
        <div><span style={labelStyle}>joints:</span> {joints.length ? joints.map((j) => `${j.name}:${j.angle_deg.toFixed(0)}°`).join(", ") : "n/a"}</div>
        {balance && (
          <div style={{ marginTop: 6 }}>
            <div><span style={labelStyle}>COM:</span> x={balance.com.x.toFixed(3)} z={balance.com.z.toFixed(3)}</div>
            <div><span style={labelStyle}>Capture Point:</span> x={balance.capturePoint.x.toFixed(3)} z={balance.capturePoint.z.toFixed(3)}</div>
            <div><span style={labelStyle}>CP margin:</span> {balance.cpMarginM.toFixed(3)}m <span style={{ color: balance.cpInsideSupport ? "#5ad17e" : "#e05a5a" }}>{balance.cpInsideSupport ? "inside" : "outside"}</span></div>
            <div><span style={labelStyle}>Support:</span> x[{balance.support.minX.toFixed(2)}, {balance.support.maxX.toFixed(2)}] z[{balance.support.minZ.toFixed(2)}, {balance.support.maxZ.toFixed(2)}]</div>
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, flex: 1 }}>
        <div style={headerStyle}>Memory Stream</div>
        {memory.length === 0 && <div style={{ color: "#5a6478" }}>no memory yet</div>}
        {memory.map((m) => (
          <div key={m.id} style={{ marginBottom: 3 }}>
            <span style={{ color: AMBER, opacity: 0.75 }}>[{m.kind}]</span> {m.content}
          </div>
        ))}
      </div>

      <div style={{ ...panelStyle, height: 140 }}>
        <div style={headerStyle}>Logs</div>
        {logs.slice(-30).map((l, i) => (
          <div key={i} style={{ color: "#8a93a8" }}>{l}</div>
        ))}
      </div>
    </div>
  );
}
