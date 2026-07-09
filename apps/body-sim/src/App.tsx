import World from "./World";
import Dashboard from "./CommandCenter/Dashboard";

export default function App() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <World />
      <Dashboard />
    </div>
  );
}
