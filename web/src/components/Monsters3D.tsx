// Low-poly monsters for the 3D Rift: our own stylised figures built from primitives (no Riot models or art).
// Every creature faces +z; callers turn it with `face` so it looks toward the middle of the map.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

type V3 = [number, number, number];

/** Flat-shaded material, optionally glowing. */
function mat(color: string, glow = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: glow ? color : "#000000",
    emissiveIntensity: glow,
    flatShading: true,
    roughness: 0.7,
    metalness: 0.08,
    toneMapped: glow < 1,
    ...extra,
  });
}

/** Yaw (around y) that turns a +z-facing figure at world (x, z) toward the map centre. */
export const face = (x: number, z: number) => Math.atan2(-x, -z);

function Bob({ children, speed = 2, amp = 0.012, phase = 0 }: { children: ReactNode; speed?: number; amp?: number; phase?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.y = Math.sin(clock.elapsedTime * speed + phase) * amp;
  });
  return <group ref={g}>{children}</group>;
}

// --- Dragon -----------------------------------------------------------------------------------------------

function wingShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.72, 0.2);
  s.lineTo(0.62, -0.06);
  s.lineTo(0.5, -0.28);
  s.lineTo(0.36, -0.16);
  s.lineTo(0.24, -0.32);
  s.lineTo(0.12, -0.18);
  s.lineTo(0, -0.22);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Hide, wing and eye colours of each dragon element. */
export const DRAGON_TINT: Record<string, [string, string, string]> = {
  dragon: ["#d8743a", "#ff9a52", "#fff3a0"],
  infernal: ["#c8452a", "#ff6a3a", "#ffd27a"],
  ocean: ["#2a8fa8", "#4fd6e6", "#d8fbff"],
  cloud: ["#9fb4c8", "#e4f0fb", "#ffffff"],
  mountain: ["#8a6a46", "#c09a68", "#ffe2a8"],
  hextech: ["#2f6fbf", "#58d8ff", "#e6fbff"],
  chemtech: ["#4f8a32", "#a6e85a", "#f2ffb0"],
  elder: ["#6e5aa8", "#c8b8ff", "#ffffff"],
};

export function Dragon({ at, yaw, kind = "dragon" }: { at: V3; yaw: number; kind?: string }) {
  const [hide, wingTint, eyeTint] = DRAGON_TINT[kind] ?? (DRAGON_TINT.dragon as [string, string, string]);
  const m = useMemo(
    () => ({
      scale: mat(hide),
      belly: mat("#f0c27c"),
      wing: mat(wingTint, 0.35, { side: THREE.DoubleSide, transparent: true, opacity: 0.88 }),
      horn: mat("#f6ead2"),
      eye: mat(eyeTint, 2.4),
      wingGeo: wingShape(),
    }),
    [hide, wingTint, eyeTint],
  );
  const body = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const flap = Math.sin(t * 3.2) * 0.55;
    if (left.current) left.current.rotation.z = 0.25 + flap;
    if (right.current) right.current.rotation.z = -(0.25 + flap);
    if (body.current) body.current.position.y = 0.12 + Math.sin(t * 3.2 - 0.6) * 0.05;
  });
  const tail: [V3, number][] = [
    [[0, 0.5, -0.36], 0.13],
    [[0, 0.44, -0.52], 0.1],
    [[0, 0.38, -0.66], 0.075],
    [[0, 0.34, -0.78], 0.055],
  ];
  return (
    <group position={at} rotation={[0, yaw, 0]} scale={0.95}>
      <group ref={body}>
        {/* body, belly and neck */}
        <mesh material={m.scale} position={[0, 0.55, -0.05]} scale={[0.22, 0.2, 0.36]} castShadow>
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
        <mesh material={m.belly} position={[0, 0.47, 0.02]} scale={[0.16, 0.12, 0.26]}>
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
        <mesh material={m.scale} position={[0, 0.72, 0.3]} rotation={[0.75, 0, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.11, 0.34, 7]} />
        </mesh>
        {/* head: skull, snout, horns, eyes */}
        <group position={[0, 0.88, 0.44]}>
          <mesh material={m.scale} scale={[0.11, 0.1, 0.12]} castShadow>
            <sphereGeometry args={[1, 9, 7]} />
          </mesh>
          <mesh material={m.scale} position={[0, -0.02, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.07, 0.22, 6]} />
          </mesh>
          {[-1, 1].map((k) => (
            <mesh key={`h${k}`} material={m.horn} position={[0.06 * k, 0.08, -0.06]} rotation={[-0.9, 0, -0.35 * k]}>
              <coneGeometry args={[0.025, 0.16, 5]} />
            </mesh>
          ))}
          {[-1, 1].map((k) => (
            <mesh key={`e${k}`} material={m.eye} position={[0.07 * k, 0.03, 0.07]}>
              <sphereGeometry args={[0.022, 6, 6]} />
            </mesh>
          ))}
        </group>
        {/* spine ridge */}
        {[0.12, 0, -0.12, -0.24].map((z, i) => (
          <mesh key={`r${i}`} material={m.horn} position={[0, 0.76 - i * 0.02, z]} rotation={[-0.5, 0, 0]}>
            <coneGeometry args={[0.03, 0.1, 4]} />
          </mesh>
        ))}
        {/* tail */}
        {tail.map(([p, r], i) => (
          <mesh key={`t${i}`} material={m.scale} position={p} scale={[r, r, r * 1.5]} castShadow>
            <sphereGeometry args={[1, 7, 6]} />
          </mesh>
        ))}
        <mesh material={m.horn} position={[0, 0.31, -0.9]} rotation={[-Math.PI / 2 - 0.3, 0, 0]}>
          <coneGeometry args={[0.05, 0.14, 4]} />
        </mesh>
        {/* legs */}
        {[
          [0.13, 0.16],
          [-0.13, 0.16],
          [0.13, -0.2],
          [-0.13, -0.2],
        ].map(([x, z], i) => (
          <mesh key={`l${i}`} material={m.scale} position={[x as number, 0.34, z as number]} rotation={[0.25, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.05, 0.22, 6]} />
          </mesh>
        ))}
        {/* wings: a bone along the leading edge and a membrane, hinged at the shoulders */}
        <group ref={left} position={[0.14, 0.7, 0.08]}>
          <mesh geometry={m.wingGeo} material={m.wing} rotation={[Math.PI / 2, 0, 0]} castShadow />
          <mesh material={m.scale} position={[0.36, 0, 0.1]} rotation={[0, -0.27, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.026, 0.75, 5]} />
          </mesh>
        </group>
        <group ref={right} position={[-0.14, 0.7, 0.08]} scale={[-1, 1, 1]}>
          <mesh geometry={m.wingGeo} material={m.wing} rotation={[Math.PI / 2, 0, 0]} castShadow />
          <mesh material={m.scale} position={[0.36, 0, 0.1]} rotation={[0, -0.27, Math.PI / 2]}>
            <cylinderGeometry args={[0.016, 0.026, 0.75, 5]} />
          </mesh>
        </group>
      </group>
      <pointLight color={wingTint} intensity={2.2} distance={2.2} position={[0, 0.9, 0.3]} />
    </group>
  );
}

// --- Baron: a great void serpent rising from its pit -------------------------------------------------------

export function Baron({ at, yaw }: { at: V3; yaw: number }) {
  const m = useMemo(
    () => ({
      hide: mat("#4a2b78"),
      plate: mat("#6b3fa8"),
      spike: mat("#b07cff", 1.6),
      eye: mat("#f0d6ff", 3),
      fang: mat("#efe4ff"),
    }),
    [],
  );
  const segs = useMemo(() => {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.15, -0.45),
      new THREE.Vector3(0.12, 0.25, -0.38),
      new THREE.Vector3(-0.05, 0.6, -0.18),
      new THREE.Vector3(0.02, 0.92, 0.05),
      new THREE.Vector3(0, 1.08, 0.24),
    ]);
    return Array.from({ length: 10 }, (_, i) => {
      const f = i / 9;
      return { p: path.getPoint(f), r: 0.27 - f * 0.12 };
    });
  }, []);
  const sway = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (sway.current) sway.current.rotation.y = Math.sin(t * 0.8) * 0.18;
    if (head.current) head.current.rotation.x = Math.sin(t * 1.6) * 0.08;
  });
  const top = segs[segs.length - 1]!.p;
  return (
    <group position={at} rotation={[0, yaw, 0]} scale={1.1}>
      <group ref={sway}>
        {segs.slice(0, -1).map(({ p, r }, i) => (
          <group key={i} position={p}>
            <mesh material={i % 2 ? m.plate : m.hide} scale={[r, r * 0.9, r]} castShadow>
              <sphereGeometry args={[1, 9, 7]} />
            </mesh>
            <mesh material={m.spike} position={[0, r * 0.75, -r * 0.55]} rotation={[-0.7, 0, 0]}>
              <coneGeometry args={[r * 0.28, r * 0.95, 4]} />
            </mesh>
          </group>
        ))}
        <group ref={head} position={[top.x, top.y, top.z]}>
          <mesh material={m.hide} scale={[0.2, 0.15, 0.26]} castShadow>
            <sphereGeometry args={[1, 10, 8]} />
          </mesh>
          <mesh material={m.plate} position={[0, 0.07, 0.04]} scale={[0.16, 0.08, 0.22]}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
          {/* crest */}
          {[-0.09, 0, 0.09].map((x, i) => (
            <mesh key={`c${i}`} material={m.spike} position={[x, 0.15, -0.08]} rotation={[-0.75, 0, -x * 3]}>
              <coneGeometry args={[0.035, i === 1 ? 0.34 : 0.24, 4]} />
            </mesh>
          ))}
          {/* mandibles */}
          {[-1, 1].map((k) => (
            <mesh key={`m${k}`} material={m.fang} position={[0.12 * k, -0.08, 0.2]} rotation={[1.9, 0, 0.35 * k]}>
              <coneGeometry args={[0.035, 0.22, 5]} />
            </mesh>
          ))}
          {[-1, 1].map((k) => (
            <mesh key={`e${k}`} material={m.eye} position={[0.1 * k, 0.04, 0.19]}>
              <sphereGeometry args={[0.03, 6, 6]} />
            </mesh>
          ))}
        </group>
      </group>
      <pointLight color="#a970ff" intensity={3} distance={2.8} position={[0, 1.3, 0.4]} />
    </group>
  );
}

// --- Jungle camps ------------------------------------------------------------------------------------------

/** Blue or red buff: a stone golem with a glowing crystal (blue) or a burning back (red). */
function Golem({ tint, fire }: { tint: string; fire: boolean }) {
  const m = useMemo(() => ({ stone: mat(fire ? "#6d5448" : "#58657a"), glow: mat(tint, 1.8), eye: mat("#fff8d0", 2.5) }), [tint, fire]);
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (flame.current) flame.current.scale.y = 1 + Math.sin(clock.elapsedTime * 9) * 0.18;
  });
  return (
    <Bob speed={1.6} amp={0.008}>
      <mesh material={m.stone} position={[0, 0.17, 0]} scale={[0.15, 0.14, 0.12]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
      </mesh>
      <mesh material={m.stone} position={[0, 0.31, 0.04]} scale={0.065} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
      </mesh>
      {[-1, 1].map((k) => (
        <mesh key={`e${k}`} material={m.eye} position={[0.025 * k, 0.32, 0.1]}>
          <sphereGeometry args={[0.012, 5, 5]} />
        </mesh>
      ))}
      {[-1, 1].map((k) => (
        <mesh key={`a${k}`} material={m.stone} position={[0.17 * k, 0.13, 0.03]} rotation={[0.2, 0, 0.25 * k]} castShadow>
          <boxGeometry args={[0.07, 0.2, 0.07]} />
        </mesh>
      ))}
      {[-1, 1].map((k) => (
        <mesh key={`l${k}`} material={m.stone} position={[0.07 * k, 0.04, 0]}>
          <boxGeometry args={[0.06, 0.08, 0.07]} />
        </mesh>
      ))}
      <mesh ref={flame} material={m.glow} position={[0, 0.3, -0.08]} rotation={[-0.35, 0, 0]}>
        {fire ? <coneGeometry args={[0.07, 0.22, 5]} /> : <octahedronGeometry args={[0.07, 0]} />}
      </mesh>
    </Bob>
  );
}

function Frog() {
  const m = useMemo(() => ({ skin: mat("#6f9a4a"), belly: mat("#c8c46a"), eye: mat("#fff2a8", 1.8), spot: mat("#3f6a33") }), []);
  return (
    <Bob speed={2.4} amp={0.015}>
      <mesh material={m.skin} position={[0, 0.11, 0]} scale={[0.17, 0.11, 0.15]} castShadow>
        <sphereGeometry args={[1, 10, 7]} />
      </mesh>
      <mesh material={m.belly} position={[0, 0.07, 0.05]} scale={[0.13, 0.07, 0.11]}>
        <sphereGeometry args={[1, 8, 6]} />
      </mesh>
      {[-1, 1].map((k) => (
        <group key={k}>
          <mesh material={m.skin} position={[0.08 * k, 0.21, 0.06]} scale={0.045}>
            <sphereGeometry args={[1, 7, 6]} />
          </mesh>
          <mesh material={m.eye} position={[0.08 * k, 0.225, 0.095]}>
            <sphereGeometry args={[0.018, 5, 5]} />
          </mesh>
          <mesh material={m.skin} position={[0.14 * k, 0.05, -0.06]} scale={[0.06, 0.05, 0.09]}>
            <sphereGeometry args={[1, 7, 6]} />
          </mesh>
          <mesh material={m.spot} position={[0.06 * k, 0.2, -0.05]} scale={0.025}>
            <sphereGeometry args={[1, 5, 4]} />
          </mesh>
        </group>
      ))}
    </Bob>
  );
}

function Wolf({ s = 1, phase = 0 }: { s?: number; phase?: number }) {
  const m = useMemo(() => ({ fur: mat("#7f8797"), dark: mat("#4a505e"), eye: mat("#8ff3ff", 2.2) }), []);
  return (
    <group scale={s}>
      <Bob speed={2} amp={0.006} phase={phase}>
        <mesh material={m.fur} position={[0, 0.12, 0]} scale={[0.065, 0.065, 0.13]} castShadow>
          <sphereGeometry args={[1, 8, 6]} />
        </mesh>
        <mesh material={m.fur} position={[0, 0.17, 0.12]} scale={0.055} castShadow>
          <sphereGeometry args={[1, 7, 6]} />
        </mesh>
        <mesh material={m.dark} position={[0, 0.155, 0.19]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.028, 0.08, 5]} />
        </mesh>
        {[-1, 1].map((k) => (
          <group key={k}>
            <mesh material={m.dark} position={[0.028 * k, 0.225, 0.11]}>
              <coneGeometry args={[0.016, 0.05, 4]} />
            </mesh>
            <mesh material={m.eye} position={[0.025 * k, 0.18, 0.165]}>
              <sphereGeometry args={[0.009, 4, 4]} />
            </mesh>
            {[0.07, -0.07].map((z) => (
              <mesh key={z} material={m.dark} position={[0.04 * k, 0.045, z]}>
                <cylinderGeometry args={[0.012, 0.012, 0.09, 4]} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh material={m.dark} position={[0, 0.15, -0.15]} rotation={[-0.9, 0, 0]}>
          <coneGeometry args={[0.025, 0.12, 5]} />
        </mesh>
      </Bob>
    </group>
  );
}

function Raptor({ s = 1, phase = 0 }: { s?: number; phase?: number }) {
  const m = useMemo(() => ({ feather: mat("#b4485c"), crest: mat("#ffb347", 1.2), beak: mat("#f1d38a"), leg: mat("#5b3340") }), []);
  return (
    <group scale={s}>
      <Bob speed={3} amp={0.01} phase={phase}>
        <mesh material={m.feather} position={[0, 0.15, 0]} scale={[0.065, 0.075, 0.085]} castShadow>
          <sphereGeometry args={[1, 8, 6]} />
        </mesh>
        <mesh material={m.feather} position={[0, 0.24, 0.06]} scale={0.042}>
          <sphereGeometry args={[1, 7, 6]} />
        </mesh>
        <mesh material={m.beak} position={[0, 0.235, 0.115]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.016, 0.06, 4]} />
        </mesh>
        {[-0.02, 0.02].map((x) => (
          <mesh key={x} material={m.crest} position={[x, 0.29, 0.04]} rotation={[-0.6, 0, x * 10]}>
            <coneGeometry args={[0.01, 0.06, 4]} />
          </mesh>
        ))}
        {[-0.03, 0, 0.03].map((x) => (
          <mesh key={`t${x}`} material={m.crest} position={[x, 0.17, -0.1]} rotation={[-1.2, 0, x * 8]}>
            <coneGeometry args={[0.015, 0.09, 3]} />
          </mesh>
        ))}
        {[-1, 1].map((k) => (
          <mesh key={`l${k}`} material={m.leg} position={[0.03 * k, 0.05, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.1, 4]} />
          </mesh>
        ))}
      </Bob>
    </group>
  );
}

function Krug({ s = 1, phase = 0 }: { s?: number; phase?: number }) {
  const m = useMemo(() => ({ rock: mat("#7a7062"), moss: mat("#56693d"), ember: mat("#ff9a3c", 2) }), []);
  return (
    <group scale={s}>
      <Bob speed={1.2} amp={0.006} phase={phase}>
        <mesh material={m.rock} position={[0, 0.12, 0]} scale={[0.14, 0.12, 0.13]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
        </mesh>
        <mesh material={m.moss} position={[0, 0.21, -0.02]} scale={[0.1, 0.04, 0.09]}>
          <dodecahedronGeometry args={[1, 0]} />
        </mesh>
        {[-1, 1].map((k) => (
          <group key={k}>
            <mesh material={m.ember} position={[0.045 * k, 0.15, 0.115]}>
              <sphereGeometry args={[0.016, 5, 5]} />
            </mesh>
            <mesh material={m.rock} position={[0.15 * k, 0.07, 0.02]} scale={0.05}>
              <dodecahedronGeometry args={[1, 0]} />
            </mesh>
          </group>
        ))}
      </Bob>
    </group>
  );
}

/** The river crab: a wide shell on thin legs, with a glowing back. */
export function Scuttle({ at, yaw }: { at: V3; yaw: number }) {
  const m = useMemo(() => ({ shell: mat("#3f8f8a"), glow: mat("#7ff5e0", 1.6), leg: mat("#2c5f5c"), eye: mat("#fff3c4", 2) }), []);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.position.x = Math.sin(clock.elapsedTime * 0.7) * 0.12;
  });
  return (
    <group position={at} rotation={[0, yaw, 0]}>
      <group ref={g}>
        <Bob speed={5} amp={0.008}>
          <mesh material={m.shell} position={[0, 0.12, 0]} scale={[0.17, 0.07, 0.14]} castShadow>
            <sphereGeometry args={[1, 10, 6]} />
          </mesh>
          <mesh material={m.glow} position={[0, 0.17, 0]} scale={[0.09, 0.025, 0.07]}>
            <sphereGeometry args={[1, 8, 5]} />
          </mesh>
          {[-1, 1].map((k) => (
            <group key={k}>
              {[0.06, 0, -0.06].map((z) => (
                <mesh key={z} material={m.leg} position={[0.16 * k, 0.06, z]} rotation={[0, 0, 0.9 * k]}>
                  <cylinderGeometry args={[0.008, 0.012, 0.13, 4]} />
                </mesh>
              ))}
              <mesh material={m.eye} position={[0.05 * k, 0.2, 0.1]}>
                <sphereGeometry args={[0.015, 5, 5]} />
              </mesh>
            </group>
          ))}
        </Bob>
      </group>
    </group>
  );
}

/** The herald: a one-eyed shelled beast of the void. */
export function Herald({ at, yaw }: { at: V3; yaw: number }) {
  const m = useMemo(() => ({ shell: mat("#5a3a8c"), plate: mat("#8a5cc8"), eye: mat("#c9a2ff", 2.6), leg: mat("#3b2560") }), []);
  return (
    <group position={at} rotation={[0, yaw, 0]} scale={1.1}>
      <Bob speed={1.4} amp={0.02}>
        <mesh material={m.shell} position={[0, 0.3, -0.05]} scale={[0.34, 0.22, 0.32]} castShadow>
          <sphereGeometry args={[1, 10, 7]} />
        </mesh>
        <mesh material={m.plate} position={[0, 0.44, -0.12]} scale={[0.24, 0.12, 0.2]}>
          <sphereGeometry args={[1, 8, 6]} />
        </mesh>
        <mesh material={m.eye} position={[0, 0.36, 0.24]}>
          <sphereGeometry args={[0.09, 10, 8]} />
        </mesh>
        {[-1, 1].map((k) =>
          [0.12, -0.08, -0.26].map((z) => (
            <mesh key={`${k}${z}`} material={m.leg} position={[0.3 * k, 0.13, z]} rotation={[0, 0, 0.7 * k]}>
              <cylinderGeometry args={[0.02, 0.035, 0.3, 5]} />
            </mesh>
          )),
        )}
        {[-1, 1].map((k) => (
          <mesh key={`h${k}`} material={m.plate} position={[0.16 * k, 0.5, 0.08]} rotation={[0.6, 0, -0.5 * k]}>
            <coneGeometry args={[0.04, 0.2, 5]} />
          </mesh>
        ))}
      </Bob>
      <pointLight color="#a970ff" intensity={1.8} distance={2} position={[0, 0.8, 0.4]} />
    </group>
  );
}

/** Void grubs: small segmented larvae, one per grub still alive. */
export function Grubs({ at, yaw, count }: { at: V3; yaw: number; count: number }) {
  const m = useMemo(() => ({ body: mat("#6a46a8"), glow: mat("#c9a2ff", 1.8) }), []);
  const spots: [number, number][] = [
    [0, 0.12],
    [-0.28, -0.12],
    [0.28, -0.12],
  ];
  return (
    <group position={[at[0], at[1] + 0.42, at[2]]} rotation={[0, yaw, 0]} scale={1.8}>
      {spots.slice(0, count).map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Bob speed={3} amp={0.02} phase={i * 1.7}>
            {[0, 1, 2].map((j) => (
              <mesh key={j} material={m.body} position={[0, 0.1 + j * 0.02, 0.09 - j * 0.09]} scale={0.085 - j * 0.015} castShadow>
                <sphereGeometry args={[1, 8, 6]} />
              </mesh>
            ))}
            <mesh material={m.glow} position={[0, 0.15, 0.15]}>
              <sphereGeometry args={[0.025, 6, 6]} />
            </mesh>
          </Bob>
        </group>
      ))}
    </group>
  );
}

const ATAKHAN_TINT: Record<string, string> = { voracious: "#e0344a", ruinous: "#9a5cff", thornbound: "#d9344a" };

/** Atakhan: a hulking horned demon with glowing eyes. */
export function Atakhan({ at, yaw, kind }: { at: V3; yaw: number; kind: string }) {
  const tint = ATAKHAN_TINT[kind] ?? "#e0344a";
  const m = useMemo(() => ({ hide: mat("#3a2228"), plate: mat("#5a2f36"), glow: mat(tint, 2), horn: mat("#e8dccb") }), [tint]);
  const chest = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (chest.current) chest.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 1.8) * 0.03);
  });
  return (
    <group position={at} rotation={[0, yaw, 0]} scale={1.05}>
      <group ref={chest}>
        <mesh material={m.hide} position={[0, 0.55, 0]} scale={[0.32, 0.36, 0.26]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
        </mesh>
        <mesh material={m.glow} position={[0, 0.58, 0.2]} scale={[0.1, 0.12, 0.06]}>
          <octahedronGeometry args={[1, 0]} />
        </mesh>
      </group>
      <mesh material={m.plate} position={[0, 0.98, 0.08]} scale={[0.15, 0.13, 0.15]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
      </mesh>
      {[-1, 1].map((k) => (
        <group key={k}>
          <mesh material={m.horn} position={[0.12 * k, 1.12, 0.02]} rotation={[-0.4, 0, -0.7 * k]}>
            <coneGeometry args={[0.04, 0.28, 5]} />
          </mesh>
          <mesh material={m.glow} position={[0.055 * k, 0.99, 0.2]}>
            <sphereGeometry args={[0.025, 6, 6]} />
          </mesh>
          <mesh material={m.plate} position={[0.36 * k, 0.5, 0.06]} rotation={[0.3, 0, 0.3 * k]} castShadow>
            <boxGeometry args={[0.13, 0.42, 0.13]} />
          </mesh>
          <mesh material={m.hide} position={[0.14 * k, 0.12, 0]} castShadow>
            <boxGeometry args={[0.13, 0.26, 0.15]} />
          </mesh>
          <mesh material={m.glow} position={[0.2 * k, 0.86, -0.12]} rotation={[-0.6, 0, -0.4 * k]}>
            <coneGeometry args={[0.035, 0.2, 4]} />
          </mesh>
        </group>
      ))}
      <pointLight color={tint} intensity={2.5} distance={2.4} position={[0, 1, 0.5]} />
    </group>
  );
}

/** One jungle camp's monsters, by camp name. */
export function CampMonsters({ name }: { name: string }) {
  switch (name) {
    case "blue_buff":
      return <Golem tint="#4aa3ff" fire={false} />;
    case "red_buff":
      return <Golem tint="#ff7a45" fire />;
    case "gromp":
      return <Frog />;
    case "wolves":
      return (
        <>
          <Wolf s={1.25} />
          <group position={[0.17, 0, -0.08]} rotation={[0, -0.3, 0]}>
            <Wolf s={0.8} phase={1} />
          </group>
          <group position={[-0.17, 0, -0.08]} rotation={[0, 0.3, 0]}>
            <Wolf s={0.8} phase={2} />
          </group>
        </>
      );
    case "raptors":
      return (
        <>
          <Raptor s={1.3} />
          {[
            [0.15, -0.06],
            [-0.15, -0.06],
            [0.08, -0.17],
            [-0.08, -0.17],
          ].map(([x, z], i) => (
            <group key={i} position={[x as number, 0, z as number]}>
              <Raptor s={0.75} phase={i} />
            </group>
          ))}
        </>
      );
    case "krugs":
      return (
        <>
          <Krug s={1.2} />
          <group position={[0.2, 0, -0.1]}>
            <Krug s={0.6} phase={1.5} />
          </group>
        </>
      );
    default:
      return null;
  }
}
