import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";

/**
 * Purely visual scenery for the futuristic set. NOTHING in this file has
 * a collider or a sensorId: the sensor-relevant physics (tagged props,
 * ground body, humanoid colliders) lives in World.tsx / Humanoid.tsx.
 * All lighting is generated locally (PMREM from three's RoomEnvironment)
 * — no CDN/HDR downloads, works offline.
 */

const GLOW_CYAN = "#36e0ff";
const GLOW_AMBER = "#ffb64d";

// ---------------------------------------------------------------------------
// atmosphere: image-based lighting, fog, background
// ---------------------------------------------------------------------------
export function Atmosphere() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.55; // dark hangar mood, but metals must read
    scene.background = new THREE.Color("#04060c");
    scene.fog = new THREE.FogExp2("#04060c", 0.02);
    return () => {
      scene.environment = null;
      scene.fog = null;
      scene.background = null;
      envTex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return (
    <>
      <ambientLight intensity={0.35} color="#8ab6ff" />
      <directionalLight
        position={[6, 10, 4]}
        intensity={2.6}
        color="#dce8ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <pointLight position={[-6, 4, -4]} intensity={26} color={GLOW_CYAN} distance={20} decay={2} />
      <pointLight position={[5, 2.5, 5]} intensity={16} color="#7d8cff" distance={16} decay={2} />
      <pointLight position={[0, 3.5, -6]} intensity={20} color="#cfe0ff" distance={16} decay={2} />
      <Stars radius={80} depth={40} count={2500} factor={3} saturation={0.4} fade speed={0.4} />
    </>
  );
}

// ---------------------------------------------------------------------------
// floor visual: emissive grid overlay (the physics ground body with its
// touch handler stays in World.tsx; this is a decorative skin above y=0)
// ---------------------------------------------------------------------------
function makeGridTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  // fine grid
  ctx.strokeStyle = "rgba(54, 224, 255, 0.28)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(size, i + 0.5); ctx.stroke();
  }
  // major lines
  ctx.strokeStyle = "rgba(54, 224, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(15, 15); // 1 tile = 2m over the 30m floor
  return tex;
}

export function FloorSkin() {
  const gridTex = useMemo(makeGridTexture, []);
  useEffect(() => () => gridTex.dispose(), [gridTex]);
  return (
    <group>
      {/* dark metallic base slab, slightly above the physics plane */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#0d1119" metalness={0.85} roughness={0.45} />
      </mesh>
      {/* emissive grid overlay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial
          color="#000000"
          emissive={GLOW_CYAN}
          emissiveIntensity={0.55}
          emissiveMap={gridTex}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </mesh>
      {/* landing-pad ring under the android's home position */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 3]}>
        <ringGeometry args={[0.85, 1.0, 48]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_CYAN} emissiveIntensity={1.4} transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// perimeter decor: pillars + horizon ring (outside sensor range, no colliders)
// ---------------------------------------------------------------------------
export function Perimeter() {
  const pillars = useMemo(() => {
    const list: { pos: [number, number, number]; h: number }[] = [];
    const R = 12.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      list.push({ pos: [Math.cos(a) * R, 0, Math.sin(a) * R], h: 5 + (i % 3) * 1.5 });
    }
    return list;
  }, []);

  return (
    <group>
      {pillars.map((p, i) => (
        <group key={i} position={p.pos}>
          <mesh castShadow position={[0, p.h / 2, 0]}>
            <cylinderGeometry args={[0.28, 0.38, p.h, 8]} />
            <meshStandardMaterial color="#141926" metalness={0.8} roughness={0.5} />
          </mesh>
          {/* light strip */}
          <mesh position={[0, p.h / 2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, p.h * 0.92, 6]} />
            <meshStandardMaterial color="#000000" emissive={i % 2 ? GLOW_CYAN : GLOW_AMBER} emissiveIntensity={1.6} />
          </mesh>
          <mesh position={[0, p.h + 0.12, 0]}>
            <sphereGeometry args={[0.16, 12, 10]} />
            <meshStandardMaterial color="#000000" emissive={i % 2 ? GLOW_CYAN : GLOW_AMBER} emissiveIntensity={2.5} />
          </mesh>
        </group>
      ))}
      {/* distant horizon glow ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[14.4, 14.7, 96]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_CYAN} emissiveIntensity={1.1} transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// tagged-prop VISUALS — mounted inside World.tsx's TaggedProp wrapper,
// which owns the collider + sensorId. Sizes stay within the original
// collider bounds so what the eye sees matches what the sensors hit.
// ---------------------------------------------------------------------------

/** waste receptacle — replaces the brown 0.6³ box (collider unchanged) */
export function TrashBinVisual() {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.24, 0.2, 0.52, 20]} />
        <meshStandardMaterial color="#1a2030" metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh castShadow position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.26, 0.24, 0.06, 20]} />
        <meshStandardMaterial color="#2a3245" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* intake slot glow */}
      <mesh position={[0, 0.215, 0]}>
        <torusGeometry args={[0.235, 0.012, 8, 28]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_AMBER} emissiveIntensity={2} />
      </mesh>
      {/* status LED */}
      <mesh position={[0, 0.05, 0.215]}>
        <boxGeometry args={[0.06, 0.16, 0.01]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_AMBER} emissiveIntensity={1.6} />
      </mesh>
      <mesh receiveShadow position={[0, -0.29, 0]}>
        <cylinderGeometry args={[0.26, 0.28, 0.04, 20]} />
        <meshStandardMaterial color="#0e121c" metalness={0.7} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** bioluminescent planter — replaces the pink 0.6³ box (collider unchanged) */
export function PlanterVisual() {
  const stems = useMemo(
    () =>
      [0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return { tilt: [Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35] as [number, number, number], len: 0.28 + (i % 3) * 0.07 };
      }),
    []
  );
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.23, 0.17, 0.34, 20]} />
        <meshStandardMaterial color="#232a3a" metalness={0.8} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.045, 0]}>
        <torusGeometry args={[0.225, 0.014, 8, 28]} />
        <meshStandardMaterial color="#000000" emissive="#9d6bff" emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.21, 0.21, 0.03, 20]} />
        <meshStandardMaterial color="#101522" roughness={0.9} />
      </mesh>
      {stems.map((s, i) => (
        <group key={i} rotation={s.tilt}>
          <mesh castShadow position={[0, 0.06 + s.len / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.02, s.len, 6]} />
            <meshStandardMaterial color="#1d3a30" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.08 + s.len, 0]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color="#0a1410" emissive="#b26bff" emissiveIntensity={2.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** paneled bulkhead — replaces the flat grey wall (collider unchanged) */
export function SciFiWallVisual() {
  const panels = useMemo(() => {
    const list: { x: number; w: number }[] = [];
    let x = -4.7;
    const widths = [1.6, 1.1, 2.0, 1.3, 1.7, 1.4];
    for (const w of widths) {
      list.push({ x: x + w / 2, w });
      x += w + 0.1;
    }
    return list;
  }, []);
  return (
    <group>
      {/* base slab */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[10, 3, 0.24]} />
        <meshStandardMaterial color="#131824" metalness={0.75} roughness={0.5} />
      </mesh>
      {/* raised panels */}
      {panels.map((p, i) => (
        <mesh key={i} castShadow position={[p.x, (i % 2 ? 0.25 : -0.15), 0.14]}>
          <boxGeometry args={[p.w, 2.1, 0.05]} />
          <meshStandardMaterial color={i % 2 ? "#1a2233" : "#161d2c"} metalness={0.85} roughness={0.4} />
        </mesh>
      ))}
      {/* horizontal light line across the wall */}
      <mesh position={[0, 0.85, 0.18]}>
        <boxGeometry args={[9.4, 0.035, 0.02]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_CYAN} emissiveIntensity={2.2} />
      </mesh>
      <mesh position={[0, -1.1, 0.18]}>
        <boxGeometry args={[9.4, 0.02, 0.02]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_AMBER} emissiveIntensity={1.4} />
      </mesh>
      {/* top trim */}
      <mesh castShadow position={[0, 1.56, 0]}>
        <boxGeometry args={[10.2, 0.12, 0.34]} />
        <meshStandardMaterial color="#0e121c" metalness={0.8} roughness={0.45} />
      </mesh>
    </group>
  );
}

/** cargo crate — replaces the brown 0.8³ box (collider unchanged) */
export function CargoCrateVisual() {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.72, 0.72, 0.72]} />
        <meshStandardMaterial color="#1c2333" metalness={0.8} roughness={0.42} />
      </mesh>
      {/* edge frame */}
      {[
        [0, 0.37, 0, 0.8, 0.06, 0.8],
        [0, -0.37, 0, 0.8, 0.06, 0.8],
      ].map(([x, y, z, w, h, d], i) => (
        <mesh key={i} castShadow position={[x, y, z]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#0e121c" metalness={0.7} roughness={0.55} />
        </mesh>
      ))}
      {/* vertical corner ribs */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} castShadow position={[sx * 0.37, 0, sz * 0.37]}>
            <boxGeometry args={[0.07, 0.8, 0.07]} />
            <meshStandardMaterial color="#0e121c" metalness={0.7} roughness={0.55} />
          </mesh>
        ))
      )}
      {/* glowing cargo-status strip */}
      <mesh position={[0, 0.12, 0.365]}>
        <boxGeometry args={[0.4, 0.05, 0.01]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_CYAN} emissiveIntensity={2} />
      </mesh>
      <mesh position={[0.25, 0.12, 0.365]}>
        <boxGeometry args={[0.05, 0.05, 0.012]} />
        <meshStandardMaterial color="#000000" emissive={GLOW_AMBER} emissiveIntensity={2.2} />
      </mesh>
    </group>
  );
}
