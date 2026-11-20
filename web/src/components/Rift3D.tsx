// A holographic 3D Summoner's Rift built from our measured geometry (no Riot map art), with optional live
// players from a replay. Loaded lazily: three.js only downloads when a 3D view is opened.
import { Billboard, Html, Line, OrbitControls, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Replay } from "../api/types";
import { iconUrl, mapUrl, type Catalog } from "../lib/ddragon";
import { CAMPS, LANES, PITS, mirror, structures } from "../lib/map";
import { frameAt, trailOf } from "../lib/replay";
import { toWorld } from "../lib/rift3d";
import { MAP_EXTENT, heightField, sample } from "../lib/terrain";

const BLUE = "#3b8cff";
const RED = "#ff5a5a";
const LANE = "#6fe3ff";
const side = (s: string) => (s === "blue" ? BLUE : RED);

function curve(points: readonly (readonly number[])[], lift = 0.02) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...toWorld(p[0] as number, p[1] as number)).setY(lift)), false, "centripetal", 0.2);
}

const WALL_H = 0.62;
const GRID = 448;
const hashN = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Summoner's Rift terrain: Riot's minimap read as a height field, rock walls up, the river carved down. */
function Terrain({ catalog }: { catalog: Catalog }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const url = mapUrl(catalog);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = img.width;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx || !alive) return;
      ctx.drawImage(img, 0, 0);
      const { h } = heightField(ctx.getImageData(0, 0, size, size).data, size, 2);
      const pos: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      const grass = new THREE.Color("#5f7040");
      const earth = new THREE.Color("#7a7448");
      const rock = new THREE.Color("#3b4236");
      const canopy = new THREE.Color("#1d3b24");
      const bed = new THREE.Color("#1b3a40");
      const stone = new THREE.Color("#5d6a72");
      for (let j = 0; j <= GRID; j++) {
        for (let i = 0; i <= GRID; i++) {
          const u = i / GRID;
          const v = j / GRID;
          const gx = u * MAP_EXTENT[0];
          const gy = (1 - v) * MAP_EXTENT[1];
          const raw = sample(h, size, u, v);
          const noise = hashN(i, j);
          // Walls: flat rocky tops and steep sides (smoothstep), with a little roughness on top only.
          // Centred on 0.5 so the wall edge stays exactly on the minimap's outline (no bloating into the paths).
          const wall = raw > 0 ? THREE.MathUtils.smoothstep(raw, 0.4, 0.6) : 0;
          const lift = raw > 0 ? wall * (0.94 + noise * 0.08) : raw * 0.55;
          const [x, , z] = toWorld(gx, gy);
          pos.push(x, lift * WALL_H, z);
          if (raw < -0.08) c.copy(bed);
          else if (wall > 0.85) c.copy(canopy).lerp(rock, noise * 0.25);
          else if (wall > 0.05) c.copy(earth).lerp(rock, wall);
          else c.copy(grass).lerp(earth, noise * 0.35);
          if (Math.abs(raw - 0.06) < 0.015) c.lerp(stone, 0.5);
          col.push(c.r, c.g, c.b);
        }
      }
      const idx: number[] = [];
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const a0 = j * (GRID + 1) + i;
          const b0 = a0 + 1;
          const c0 = a0 + GRID + 1;
          const d0 = c0 + 1;
          idx.push(a0, c0, b0, b0, c0, d0);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      setGeometry(g);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.92} metalness={0.02} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Water() {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = 0.22 + Math.sin(clock.elapsedTime * 1.3) * 0.06;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]} receiveShadow>
      <planeGeometry args={[15.5, 15.5]} />
      <meshStandardMaterial ref={ref} color="#2b86b8" emissive="#1f7fbf" transparent opacity={0.72} roughness={0.15} metalness={0.3} />
    </mesh>
  );
}

const CAMP_LABEL: Record<string, string> = { blue_buff: "Blue", gromp: "Gromp", wolves: "Wolves", raptors: "Raptors", red_buff: "Red", krugs: "Krugs" };

function Lanes({ glow }: { glow?: Record<string, number> }) {
  // With a highlight, colour runs from the neutral lane cyan to red in proportion to the strongest lane.
  const max = glow ? Math.max(...Object.values(glow), 0.0001) : 1;
  return (
    <>
      {Object.entries(LANES).map(([name, pts]) => {
        const k = glow ? Math.min((glow[name] ?? 0) / max, 1) : 0;
        if (!glow) return null;
        const color = new THREE.Color(LANE).lerp(new THREE.Color(RED), k);
        return (
          <mesh key={name}>
            <tubeGeometry args={[curve(pts, 0.12), 160, 0.05 + k * 0.12, 8, false]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5 + k * 1.8} toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

const STONE = "#aeb8c6";

/** Turret: stone base, tapered shaft, coloured crown and a glowing eye on top. */
function Turret({ at, color, tall = false }: { at: [number, number, number]; color: string; tall?: boolean }) {
  const h = tall ? 0.62 : 0.5;
  return (
    <group position={at}>
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.2, 0.08, 6]} />
        <meshStandardMaterial color={STONE} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.08 + h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.11, h, 6]} />
        <meshStandardMaterial color={STONE} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.12 + h, 0]} castShadow>
        <coneGeometry args={[0.13, 0.16, 6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.25 + h, 0]}>
        <sphereGeometry args={[0.055, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Inhibitor: a crystal floating and turning above a round pedestal ringed in the team colour. */
function Inhibitor({ at, color }: { at: [number, number, number]; color: string }) {
  const crystal = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!crystal.current) return;
    crystal.current.rotation.y = clock.elapsedTime * 0.9;
    crystal.current.position.y = 0.36 + Math.sin(clock.elapsedTime * 2 + at[0]) * 0.03;
  });
  return (
    <group position={at}>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.27, 0.3, 0.08, 24]} />
        <meshStandardMaterial color={STONE} roughness={0.55} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.22, 0.02, 8, 40]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh ref={crystal} castShadow>
        <octahedronGeometry args={[0.15, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} transparent opacity={0.92} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Nexus: the large crystal on a stepped platform, with a slow pulse ring. */
function Nexus({ at, color }: { at: [number, number, number]; color: string }) {
  const ring = useRef<THREE.Mesh>(null);
  const crystal = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + ((clock.elapsedTime * 0.5) % 1) * 0.8);
    if (crystal.current) crystal.current.rotation.y = clock.elapsedTime * 0.4;
  });
  return (
    <group position={at}>
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.62, 0.72, 0.14, 8]} />
        <meshStandardMaterial color={STONE} roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.19, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.5, 0.1, 8]} />
        <meshStandardMaterial color="#8d98a8" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh ref={crystal} position={[0, 0.72, 0]} castShadow>
        <octahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.3} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.95, 1.03, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} toneMapped={false} />
      </mesh>
      <pointLight color={color} intensity={6} distance={6} position={[0, 1.4, 0]} />
    </group>
  );
}

function Structures() {
  const list = useMemo(() => structures(), []);
  return (
    <>
      {list.map((st, i) => {
        const at = toWorld(st.x, st.y);
        const color = side(st.side);
        if (st.kind === "nexus") return <Nexus key={i} at={at} color={color} />;
        if (st.kind === "inhibitor") return <Inhibitor key={i} at={at} color={color} />;
        return <Turret key={i} at={at} color={color} tall={st.kind === "nexus_turret"} />;
      })}
    </>
  );
}

function Pit({ at, label }: { at: readonly number[]; label: string }) {
  const [x, , z] = toWorld(at[0] as number, at[1] as number);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * 0.6;
  });
  return (
    <group position={[x, 0.05, z]} name={label}>
      <Html center position={[0, 0.9, 0]} distanceFactor={11} className="map3d-label pit">
        {label === "dragon" ? "Dragon" : "Baron"}
      </Html>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.05, 8, 48]} />
        <meshStandardMaterial color="#c79bff" emissive="#a970ff" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Camps({ glowSide, startTop, labels }: { glowSide?: "blue" | "red"; startTop?: number; labels: boolean }) {
  return (
    <>
      {(["blue", "red"] as const).flatMap((sd) =>
        Object.entries(CAMPS).map(([name, cp]) => {
          const [gx, gy] = mirror(cp, sd);
          const [x, , z] = toWorld(gx, gy);
          const topSide = ["blue_buff", "gromp", "wolves"].includes(name);
          const heat = glowSide === sd && startTop !== undefined ? (topSide ? startTop : 1 - startTop) : 0;
          const buff = name === "blue_buff" || name === "red_buff";
          const tint = heat ? RED : buff ? (name === "blue_buff" ? "#4aa3ff" : "#ff7a45") : "#e8c46a";
          return (
            <group key={`${sd}-${name}`} position={[x, 0.04, z]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.16 + heat * 0.2, 0.22 + heat * 0.25, 32]} />
                <meshBasicMaterial color={tint} transparent opacity={0.85} toneMapped={false} />
              </mesh>
              <mesh position={[0, 0.12 + heat * 0.2, 0]}>
                <octahedronGeometry args={[0.09 + heat * 0.12, 0]} />
                <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.8 + heat * 2.5} toneMapped={false} />
              </mesh>
              {labels && (
                <Html center position={[0, 0.5, 0]} distanceFactor={11} className={`map3d-label ${heat ? "hot" : ""}`}>
                  {CAMP_LABEL[name]}
                  {heat ? ` ${Math.round(heat * 100)}%` : ""}
                </Html>
              )}
            </group>
          );
        }),
      )}
    </>
  );
}

function ChampToken({ url, color, position }: { url: string; color: string; position: [number, number, number] }) {
  const tex = useTexture(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (
    <group position={position}>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.7, 6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Billboard>
        <mesh>
          <circleGeometry args={[0.3, 32]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.001]}>
          <ringGeometry args={[0.29, 0.37, 40]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

function Players({ replay, t, trails, catalog, follow }: { replay: Replay; t: number; trails: boolean; catalog: Catalog; follow: number | null }) {
  const frame = frameAt(replay, t);
  return (
    <>
      {replay.players.map((p) => {
        const at = frame[p.slot];
        if (!at) return null;
        const [x, , z] = toWorld(at.x, at.y);
        const color = side(p.side);
        const url = p.champion ? iconUrl(catalog, p.champion) : null;
        const trail = trails ? trailOf(replay, p.slot, t, 20) : [];
        return (
          <group key={p.slot}>
            {trail.length > 1 && (
              <Line points={trail.map((q) => { const w = toWorld(q.x, q.y); return [w[0], 0.06, w[2]] as [number, number, number]; })} color={color} lineWidth={2} transparent opacity={0.55} />
            )}
            {url ? (
              <Suspense fallback={<mesh position={[x, 0.75, z]}><sphereGeometry args={[0.2, 16, 16]} /><meshBasicMaterial color={color} /></mesh>}>
                <ChampToken url={url} color={follow === p.slot ? "#ffe066" : color} position={[x, follow === p.slot ? 0.95 : 0.75, z]} />
              </Suspense>
            ) : (
              <mesh position={[x, 0.4, z]}>
                <sphereGeometry args={[0.22, 16, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {replay.events
        .filter((e) => e.kind === "kill" && e.x !== null && e.y !== null && t >= e.t && t - e.t < 6)
        .map((e) => {
          const [x, , z] = toWorld(e.x as number, e.y as number);
          const k = (t - e.t) / 6;
          return (
            <mesh key={`k-${e.t}-${e.slot}`} position={[x, 0.08, z]} rotation={[-Math.PI / 2, 0, 0]} scale={0.4 + k * 2.4}>
              <ringGeometry args={[0.36, 0.42, 48]} />
              <meshBasicMaterial color="#ff3d3d" transparent opacity={1 - k} toneMapped={false} />
            </mesh>
          );
        })}
    </>
  );
}


const HOME_CAM = new THREE.Vector3(0, 12.5, 11.5);

/** Follows one player smoothly; when the follow is cleared, glides back to the overview. */
function CameraRig({ replay, t, follow }: { replay?: Replay; t: number; follow: number | null }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  const returning = useRef(false);
  const last = useRef<number | null>(null);
  const goal = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!controls) return;
    if (last.current !== follow) {
      returning.current = follow === null && last.current !== null;
      last.current = follow;
    }
    if (follow !== null && replay) {
      const at = frameAt(replay, t)[replay.players.findIndex((p) => p.slot === follow)];
      if (!at) return;
      const [x, , z] = toWorld(at.x, at.y);
      goal.set(x, 0, z);
      controls.target.lerp(goal, 0.08);
      camera.position.lerp(goal.clone().add(new THREE.Vector3(0, 6.2, 5.2)), 0.05);
      controls.update();
    } else if (returning.current) {
      controls.target.lerp(goal.set(0, 0, 0), 0.06);
      camera.position.lerp(HOME_CAM, 0.06);
      controls.update();
      if (camera.position.distanceTo(HOME_CAM) < 0.05) returning.current = false;
    }
  });
  return null;
}

export interface Rift3DProps {
  catalog: Catalog;
  replay?: Replay;
  t?: number;
  trails?: boolean;
  /** Ambient mode: slow auto-rotation, used as a backdrop. */
  ambient?: boolean;
  /** Highlight a jungler's habits: lane shares where they show up first, and the side of the jungle they open. */
  laneGlow?: Record<string, number>;
  glowSide?: "blue" | "red";
  startTop?: number;
  className?: string;
  /** Slot of the player the camera follows. */
  follow?: number | null;
  /** Show camp and pit names (off during a replay to keep the map readable). */
  labels?: boolean;
}

export default function Rift3D({ catalog, replay, t = 0, trails = true, ambient = false, laneGlow, glowSide, startTop, className, labels = !replay, follow = null }: Rift3DProps) {
  return (
    <div className={`rift3d ${className ?? ""}`}>
      <Canvas shadows camera={{ position: [0, 12.5, 11.5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={["#05080e"]} />
        <fog attach="fog" args={["#05080e", 22, 40]} />
        <hemisphereLight args={["#bcd7ff", "#1a2410", 0.55]} />
        <directionalLight
          position={[-7, 13, 6]}
          intensity={1.6}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
        />
        <Terrain catalog={catalog} />
        <Water />
        <Lanes glow={laneGlow} />
        <Structures />
        <Pit at={PITS.dragon} label="dragon" />
        <Pit at={PITS.baron} label="baron" />
        <Camps glowSide={glowSide} startTop={startTop} labels={labels} />
        {replay && <Players replay={replay} t={t} trails={trails} catalog={catalog} follow={follow} />}
        <CameraRig replay={replay} t={t} follow={follow} />
        <OrbitControls makeDefault enablePan={false} minDistance={7} maxDistance={26} maxPolarAngle={1.25} autoRotate={ambient} autoRotateSpeed={0.35} />
        <EffectComposer>
          <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.55} luminanceSmoothing={0.25} />
          <Vignette eskil={false} offset={0.2} darkness={0.75} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
