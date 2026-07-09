import { useBodyOS } from "../store";

const BRAIN_WS_URL = import.meta.env.VITE_BRAIN_WS_URL || "ws://localhost:8000/ws/brain";
const SESSION_ID = "default-session";

let socket: WebSocket | null = null;
let pendingResolvers: ((decision: any) => void)[] = [];

export function connectBrain() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;

  socket = new WebSocket(BRAIN_WS_URL);

  socket.onopen = () => {
    useBodyOS.getState().setConnected(true);
    useBodyOS.getState().pushLog("Connected to brain-api");
  };

  socket.onclose = () => {
    useBodyOS.getState().setConnected(false);
    useBodyOS.getState().pushLog("Disconnected from brain-api");
    socket = null;
    setTimeout(connectBrain, 2000); // real reconnect, not a fake success state
  };

  socket.onerror = () => {
    useBodyOS.getState().pushLog("brain-api connection error");
  };

  socket.onmessage = (event) => {
    const decision = JSON.parse(event.data);
    useBodyOS.getState().setDecision(decision);
    useBodyOS.getState().pushLog(`[${decision.source}] ${decision.goal}: ${decision.reasoning}`);
    const resolver = pendingResolvers.shift();
    if (resolver) resolver(decision);
  };
}

export function sendSensorSnapshot(snapshot: Record<string, unknown>): Promise<any> | null {
  if (!socket || socket.readyState !== WebSocket.OPEN) return null;
  socket.send(JSON.stringify({ session_id: SESSION_ID, ...snapshot }));
  return new Promise((resolve) => pendingResolvers.push(resolve));
}

export async function fetchMemory(limit = 50) {
  const base = import.meta.env.VITE_BRAIN_HTTP_URL || "http://localhost:8000";
  const res = await fetch(`${base}/memory/${SESSION_ID}?limit=${limit}`);
  if (!res.ok) throw new Error(`Memory fetch failed: ${res.status}`);
  return res.json();
}

export { SESSION_ID };
