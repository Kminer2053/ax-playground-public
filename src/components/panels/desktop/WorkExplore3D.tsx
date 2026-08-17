"use client";
/**
 * 업무탐색 3D — 무한성 복셀 공간(데모 v7 확정 비주얼)에 실데이터 바인딩.
 * 씬 수학(정육면체 복셀·포켓·직각 통로·90° 스냅 카메라·통로 탐험)은 데모 원형 보존.
 * 신규: /api/work100/map 실데이터 + 부서 자동배치(하드코딩 center 대체) + promoted/candidate 시각차.
 * 노드 클릭 → onSelectTask(taskId) (온톨로지 패널은 상위 셸이 담당).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

type MapDept = { id: string; label: string; honbu: string; deptPath: string; kind: string; order: number; taskCount: number };
type MapTask = { id: string; label: string; dept: string; desc: string; fn: string; org: string; status: string };
type MapData = {
  depts: MapDept[];
  tasks: MapTask[];
  deptEdges: [string, string][];
  crossLinks: { doc: string; tasks: string[] }[];
  precedes?: [string, string][];
  stats: { depts: number; tasks: number; promoted: number; candidate: number; crossLinks: number };
};

// 무한성 warm 팔레트 — 기능 도메인 6 고정색(재커레이션 검토 아티팩트와 동일 배색)
const DOMAIN_HUES: Record<string, number> = {
  "경영지원": 0xe0a04a, "재무·계약": 0xd97a4a, "영업·상품": 0xa78ae0,
  "광고·홍보": 0xdc8f6a, "안전·시설": 0x4ec2a8, "감사·정보": 0x7aa3d9,
};
const GROUP_HUES = [0xe0a04a, 0xd97a4a, 0x4ec2a8, 0xa78ae0, 0x7aa3d9, 0xcdb04e, 0xd98736, 0x8fb96a, 0xdc8f6a];

type Group = { key: string; label: string; hue: number; pos: THREE.Vector3; pocketR: number; tasks: MapTask[] };
type SceneLayout = {
  groups: Group[];
  taskPos: Map<string, THREE.Vector3>;
  taskGroup: Map<string, string>;
};

/**
 * 업무 단위 그룹 배치 — 기능 도메인(6: 경영지원·재무계약·영업상품·광고홍보·안전시설·감사정보)으로 묶는다.
 * (부서·본부가 아닌 '일의 성격' — 재커레이션 확정 기능축. 소관=업무→부서는 온톨로지에 그대로.)
 */
function buildLayout(data: MapData): SceneLayout {
  const groupOf = (t: MapTask) => t.fn?.split(">")[0]?.trim() || "기타";
  const byGroup = new Map<string, MapTask[]>();
  for (const t of data.tasks) {
    const g = groupOf(t);
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(t);
  }
  const keys = [...byGroup.keys()].sort((a, b) => byGroup.get(b)!.length - byGroup.get(a)!.length);
  const G = keys.length;
  const groups: Group[] = [];
  const taskPos = new Map<string, THREE.Vector3>();
  const taskGroup = new Map<string, string>();
  const R = 40;
  keys.forEach((key, gi) => {
    const tasks = byGroup.get(key)!;
    const hue = DOMAIN_HUES[key] ?? GROUP_HUES[gi % GROUP_HUES.length];
    // 그룹 포켓 중심 — 구면 분산(중앙 대공동 주위)
    const az = (gi / G) * Math.PI * 2;
    const el = (gi % 2 ? 1 : -1) * (0.28 + (gi % 3) * 0.12);
    const pos = new THREE.Vector3(R * Math.cos(el) * Math.cos(az), R * Math.sin(el), R * Math.cos(el) * Math.sin(az));
    const pocketR = 11 + Math.sqrt(tasks.length) * 1.9; // 업무 수에 비례(포켓 크기)
    groups.push({ key, label: key, hue, pos, pocketR, tasks });
    // 포켓 내부 업무 배치 — 피보나치 구 채움(안쪽부터)
    const n = tasks.length;
    tasks.forEach((t, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const rr = pocketR * 0.62 * Math.cbrt((i + 0.5) / n);
      taskPos.set(t.id, new THREE.Vector3(
        pos.x + rr * Math.sin(phi) * Math.cos(theta),
        pos.y + rr * Math.cos(phi),
        pos.z + rr * Math.sin(phi) * Math.sin(theta),
      ));
      taskGroup.set(t.id, key);
    });
  });
  return { groups, taskPos, taskGroup };
}

export default function WorkExplore3D({ onSelectTask }: { onSelectTask?: (taskId: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [touring, setTouring] = useState(false);
  // 씬 제어 핸들(React 핸들러 → 씬)
  const ctrl = useRef<{
    setFilter: (d: string | null, q: string) => void;
    selectMatch: () => void;
    focusDept: (d: string | null) => void;
    startTour: () => void;
    stopTour: () => void;
    selectTask: (id: string) => void;
  } | null>(null);

  useEffect(() => {
    fetch("/api/work100/map")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("map 조회 실패"))))
      .then(setData)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!data || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;

    // WebGL 지원 확인
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setErr("이 환경은 3D(WebGL)를 지원하지 않습니다.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0705);
    scene.fog = new THREE.Fog(0x0a0705, 40, 120);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 600);
    // 은은한 광원 번짐(할레이션) — 창빛·등불이 어둠으로 배어나오는 무한성 특유의 공기.
    // 어두운 배경 전제라 블룸 허용(지식그래프 3D는 흰 배경이라 블룸 금지 — 그쪽과 다름).
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.7, 0.58);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    scene.add(new THREE.AmbientLight(0x3a2c1c, 1.5));
    const warm1 = new THREE.PointLight(0xffb45e, 850, 0, 2); warm1.position.set(10, 20, 12); scene.add(warm1); // 큐브 전용 조명 — 과세기는 블룸 플레어(과노출 백색)를 만든다
    const warm2 = new THREE.PointLight(0xff9a3c, 420, 0, 2); warm2.position.set(-16, -14, -10); scene.add(warm2);
    const rim = new THREE.DirectionalLight(0x5a4630, 1.0); rim.position.set(80, 120, 60); scene.add(rim);

    const box = new THREE.BoxGeometry(1, 1, 1);
    const rng = (a: number, b: number) => a + Math.random() * (b - a);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const disposables: { dispose: () => void }[] = [box];

    // ── 무한성 내부 재현(레퍼런스 실사 조사 기반) ─────────────────────────────
    // 구판은 田자 2×2 큰 창의 균일 복셀이라 벽지처럼 단조로웠다. 실내 레퍼런스의 어휘는
    // ① 가는 살 장지 격자(4×6)·기둥·층보·툇마루 띠 ② 1~3층 세로 타워의 요철 스카이라인
    // ③ 공동에 면한 발코니 ④ 어둠에 떠 있는 다다미 마루섬 ⑤ 수직 샤프트의 낙하감.
    type FacadeStyle = "fine" | "coarse" | "vert" | "wall" | "rail";
    // 점등 칸 주변으로 빛이 목재에 배어나오게(할레이션) — 프레임을 그리기 전에 깐다
    function paneGlow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      const cx = x + w / 2, cy = y + h / 2, r = Math.max(w, h) * 1.35;
      const rad = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, r);
      rad.addColorStop(0, "rgba(255,195,115,0.5)"); rad.addColorStop(0.45, "rgba(255,185,105,0.22)"); rad.addColorStop(1, "rgba(255,185,105,0)");
      g.fillStyle = rad; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    function drawPane(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: FacadeStyle, lit: boolean) {
      if (lit) {
        paneGlow(g, x, y, w, h);
        const gr = g.createLinearGradient(0, y, 0, y + h);
        const tone = [["#ffd9a0", "#e08a35"], ["#ffca7e", "#d97f2e"], ["#f2ab52", "#b96820"]][(Math.random() * 3) | 0];
        gr.addColorStop(0, tone[0]); gr.addColorStop(1, tone[1]);
        g.fillStyle = gr; g.fillRect(x, y, w, h);
      } else {
        g.fillStyle = Math.random() < 0.5 ? "#171008" : "#100a05"; g.fillRect(x, y, w, h);
      }
      const cols = style === "coarse" ? 2 : style === "vert" ? 6 : 4;
      const rows = style === "coarse" ? 3 : style === "vert" ? 0 : 6;
      g.strokeStyle = lit ? "rgba(52,29,8,0.92)" : "rgba(255,180,94,0.07)";
      g.lineWidth = style === "coarse" ? 2.5 : 1.5;
      g.beginPath();
      for (let c = 1; c < cols; c++) { g.moveTo(x + (w * c) / cols, y); g.lineTo(x + (w * c) / cols, y + h); }
      for (let r = 1; r < rows; r++) { g.moveTo(x, y + (h * r) / rows); g.lineTo(x + w, y + (h * r) / rows); }
      if (style === "vert") { g.moveTo(x, y + h * 0.55); g.lineTo(x + w, y + h * 0.55); } // 중간 띠장
      g.stroke();
      g.strokeStyle = lit ? "#2a1a06" : "#231505"; g.lineWidth = lit ? 3 : 2; g.strokeRect(x, y, w, h);
    }
    function makeFacadeTexture(floors: number, style: FacadeStyle) {
      const W = 128, H = 128 * floors;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#0d0906"; g.fillRect(0, 0, W, H);
      for (let f = 0; f < floors; f++) {
        const oy = f * 128;
        g.fillStyle = "#241505"; g.fillRect(0, oy, W, 7); g.fillRect(0, oy + 121, W, 7); // 층보
        g.fillStyle = "#4a2f0e"; g.fillRect(0, oy + 116, W, 5);                          // 툇마루 띠
        g.fillStyle = "#1b1004"; g.fillRect(0, oy, 6, 128); g.fillRect(W - 6, oy, 6, 128); g.fillRect(W / 2 - 3, oy, 6, 128); // 기둥
        if (style === "wall") {
          // 판벽 전각 — 널판 가로결 + 드물게 작은 창 하나(빛이 더 귀해서 강조됨)
          g.fillStyle = "#150d06"; g.fillRect(6, oy + 7, W - 12, 109);
          g.strokeStyle = "#221405"; g.lineWidth = 1.5;
          g.beginPath();
          for (let ln = 1; ln < 8; ln++) { g.moveTo(6, oy + 7 + ln * 13.6); g.lineTo(W - 6, oy + 7 + ln * 13.6); }
          g.stroke();
          if (Math.random() < 0.4) drawPane(g, 44, oy + 26, 40, 46, "fine", Math.random() < 0.7);
        } else if (style === "rail") {
          // 하단 난간 + 상단 장지 — 발코니 층
          for (let pnl = 0; pnl < 2; pnl++) {
            const x = 8 + pnl * 61, w = 47;
            drawPane(g, x, oy + 11, w, 70, "fine", Math.random() < 0.45);
          }
          g.fillStyle = "#120b05"; g.fillRect(6, oy + 86, W - 12, 30);
          g.strokeStyle = "#5a3a14"; g.lineWidth = 2.5;
          g.beginPath();
          for (let sl = 0; sl < 15; sl++) { const x = 9 + sl * 8; g.moveTo(x, oy + 88); g.lineTo(x, oy + 114); }
          g.moveTo(6, oy + 88); g.lineTo(W - 6, oy + 88);
          g.stroke();
        } else {
          for (let pnl = 0; pnl < 2; pnl++) {
            const x = 8 + pnl * 61, w = 47;
            drawPane(g, x, oy + 11, w, 102, style, Math.random() < 0.45);
          }
        }
      }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    // 아키타입 풀 — 같은 건물은 같은 양식(건축적 일관성), 건물마다 양식이 섞여 반복감을 깬다
    const STYLE_POOL: Record<1 | 2 | 3, FacadeStyle[]> = {
      1: ["fine", "fine", "coarse", "wall", "rail", "vert"],
      2: ["fine", "fine", "vert", "rail", "coarse"],
      3: ["fine", "vert", "fine"],
    };
    const facadeTexes: Record<1 | 2 | 3, THREE.CanvasTexture[]> = {
      1: STYLE_POOL[1].map((st) => makeFacadeTexture(1, st)),
      2: STYLE_POOL[2].map((st) => makeFacadeTexture(2, st)),
      3: STYLE_POOL[3].map((st) => makeFacadeTexture(3, st)),
    };
    ([1, 2, 3] as const).forEach((f) => facadeTexes[f].forEach((t) => disposables.push(t)));
    function makeTatamiTexture() {
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#1c1006"; g.fillRect(0, 0, 128, 128);   // 테두리(툇마루 목재)
      const M = 9;
      for (let ix = 0; ix < 3; ix++) for (let iy = 0; iy < 3; iy++) {
        const x = M + ix * 37, y = M + iy * 37, w = 36, h = 36;
        const gr = g.createLinearGradient(x, y, x + w, y + h);
        gr.addColorStop(0, "#f0b25c"); gr.addColorStop(1, "#c07c2a");
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        g.strokeStyle = "rgba(70,40,10,0.7)"; g.lineWidth = 1;   // 다다미 결
        g.beginPath();
        if ((ix + iy) % 2) for (let l = 1; l < 5; l++) { g.moveTo(x, y + (h * l) / 5); g.lineTo(x + w, y + (h * l) / 5); }
        else for (let l = 1; l < 5; l++) { g.moveTo(x + (w * l) / 5, y); g.lineTo(x + (w * l) / 5, y + h); }
        g.stroke();
        g.strokeStyle = "#3a2208"; g.lineWidth = 2; g.strokeRect(x, y, w, h);
      }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }

    // 부서 배치
    const layout = buildLayout(data);
    const groupsArr = layout.groups;
    const groupByKey = new Map(groupsArr.map((g) => [g.key, g]));

    // 복셀 공동: 부서 포켓 + 직각 통로 + 중앙 대공동
    const CX = 5.4, CY = 4.2, CZ = 5.4, NX = 23, NY = 30, NZ = 23;
    type Cav = { t: "ell"; c: THREE.Vector3; r: THREE.Vector3 } | { t: "seg"; a: THREE.Vector3; b: THREE.Vector3; r: number };
    const cavities: Cav[] = [];
    groupsArr.forEach((g) => cavities.push({ t: "ell", c: g.pos, r: V(g.pocketR, g.pocketR * 0.82, g.pocketR) }));
    const corridorLegs: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
    function addCorridor(A: THREE.Vector3, B: THREE.Vector3, r: number) {
      const p1 = V(B.x, A.y, A.z), p2 = V(B.x, B.y, A.z);
      const pts = [A, p1, p2, B];
      for (let i = 0; i < 3; i++) {
        if (pts[i].distanceTo(pts[i + 1]) < 0.5) continue;
        cavities.push({ t: "seg", a: pts[i], b: pts[i + 1], r });
        corridorLegs.push({ a: pts[i].clone(), b: pts[i + 1].clone() });
      }
    }
    // 방위각 순 정렬로 큰 루프(하나로 연결) + 중앙 대공동 경유 지름길
    const ring = [...groupsArr].sort((a, b) => Math.atan2(a.pos.z, a.pos.x) - Math.atan2(b.pos.z, b.pos.x));
    for (let i = 0; i < ring.length; i++) addCorridor(ring[i].pos, ring[(i + 1) % ring.length].pos, 4.6);
    if (ring.length > 4) {
      addCorridor(ring[0].pos, ring[Math.floor(ring.length / 2)].pos, 4.2);
      addCorridor(ring[Math.floor(ring.length / 4)].pos, ring[Math.floor((3 * ring.length) / 4)].pos, 4.2);
    }
    cavities.push({ t: "ell", c: V(0, 0, 0), r: V(34, 26, 34) });
    // 수직 샤프트 — 내려다보면 끝이 안 보이는 낙하감(무한성의 수직성)
    cavities.push({ t: "seg", a: V(17, -70, -13), b: V(17, 70, -13), r: 5.2 });
    cavities.push({ t: "seg", a: V(-19, -70, 15), b: V(-19, 70, 15), r: 5.2 });

    const _sv = new THREE.Vector3(), _sw = new THREE.Vector3();
    function inCavity(pt: THREE.Vector3) {
      for (const c of cavities) {
        if (c.t === "ell") {
          const dx = (pt.x - c.c.x) / c.r.x, dy = (pt.y - c.c.y) / c.r.y, dz = (pt.z - c.c.z) / c.r.z;
          if (dx * dx + dy * dy + dz * dz < 1) return true;
        } else {
          _sv.subVectors(c.b, c.a); _sw.subVectors(pt, c.a);
          const h = Math.max(0, Math.min(1, _sw.dot(_sv) / _sv.lengthSq()));
          if (_sw.addScaledVector(_sv, -h).length() < c.r) return true;
        }
      }
      return false;
    }
    // 세로 타워 병합 — 같은 기둥열(i,k)의 연속 구간을 1~3층 타워로 묶어 요철 스카이라인을 만든다.
    // 타워 사이 이격(스케일 0.86~0.96)이 어두운 틈이 되어 '벽지' 대신 '건물군'으로 읽힌다.
    type Inst = { x: number; y: number; z: number; sx: number; sy: number; sz: number; warm: number; rot: number };
    const towerBuckets: Record<1 | 2 | 3, Inst[]> = { 1: [], 2: [], 3: [] };
    const balconies: { x: number; y: number; z: number; dx: number; dz: number }[] = [];
    const caps: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    const pv = new THREE.Vector3();
    const pv2 = new THREE.Vector3();
    const DIRS = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1), V(0, 1, 0), V(0, -1, 0)];
    // 방문 격자 — 폭·깊이 병합(넓은 전각)이 겹치지 않게
    const visited = new Uint8Array(NX * NY * NZ);
    const vidx = (i: number, j: number, k: number) => (i * NY + j) * NZ + k;
    const cellC = (i: number, j: number, k: number, out: THREE.Vector3) =>
      out.set((i - NX / 2 + 0.5) * CX, (j - NY / 2 + 0.5) * CY, (k - NZ / 2 + 0.5) * CZ);
    const freeCell = (i: number, j: number, k: number) => {
      if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return false;
      if (visited[vidx(i, j, k)]) return false;
      cellC(i, j, k, pv2);
      return !inCavity(pv2);
    };
    for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
      let j = 0;
      while (j < NY) {
        cellC(i, j, k, pv);
        if (visited[vidx(i, j, k)] || inCavity(pv)) { j++; continue; }
        // 외곽 침식 — 경계에 가까울수록 결손 확률을 높여 바깥 실루엣을 요철로
        const edge = Math.min(i, NX - 1 - i, j, NY - 1 - j, k, NZ - 1 - k);
        if (edge === 0 && Math.random() < 0.5) { j++; continue; }
        if (edge === 1 && Math.random() < 0.22) { j++; continue; }
        let run = 1;
        while (run < 3 && freeCell(i, j + run, k)) run++;
        const fl = (run === 3 && Math.random() < 0.55 ? 3 : run >= 2 && Math.random() < 0.6 ? 2 : 1) as 1 | 2 | 3;
        if (Math.random() < 0.04) { j += fl; continue; } // 드문 결손 — 요철
        // 폭·깊이 병합 — 넓은 전각(창살이 옆으로 넓어져 다른 유형으로 읽힘)
        let w2 = false, d2 = false;
        const spanFree = (di: number, dk: number) => { for (let q = 0; q < fl; q++) if (!freeCell(i + di, j + q, k + dk)) return false; return true; };
        const mr = Math.random();
        if (mr < 0.24 && spanFree(1, 0)) w2 = true;
        else if (mr < 0.4 && spanFree(0, 1)) d2 = true;
        for (let q = 0; q < fl; q++) {
          visited[vidx(i, j + q, k)] = 1;
          if (w2) visited[vidx(i + 1, j + q, k)] = 1;
          if (d2) visited[vidx(i, j + q, k + 1)] = 1;
        }
        // 공동 인접(노출) 판정 — 수평 노출면엔 발코니, 노출 타워만 드물게 거꾸로(중력 무시)
        let expDir: THREE.Vector3 | null = null;
        for (const d of DIRS) {
          pv2.set(pv.x + d.x * CX, pv.y + d.y * CY, pv.z + d.z * CZ);
          if (inCavity(pv2)) { expDir = d; break; }
        }
        const cy = (j + (fl - 1) / 2 - NY / 2 + 0.5) * CY;
        const cx = pv.x + (w2 ? CX / 2 : 0) + rng(-0.3, 0.3);
        const cz = pv.z + (d2 ? CZ / 2 : 0) + rng(-0.3, 0.3);
        const slim = !w2 && !d2 && Math.random() < 0.08; // 세장탑 — 홀쭉한 망루
        const sx = (w2 ? 2 : 1) * CX * (slim ? 0.62 : rng(0.86, 0.96));
        const sz = (d2 ? 2 : 1) * CZ * (slim ? 0.62 : rng(0.86, 0.96));
        towerBuckets[fl].push({
          x: cx, y: cy, z: cz, sx, sy: fl * CY * rng(0.94, 0.99), sz,
          warm: 0.36 + Math.random() * 0.58,
          rot: expDir && Math.random() < 0.12 ? 1 : 0,
        });
        // 끝부분 마감 — 상부가 공동/외기로 열린 타워는 2단 처마 또는 옥상 파라펫으로 마감(원작 스타일)
        if (!freeCell(i, j + fl, k) ? (j + fl >= NY || (cellC(i, j + fl, k, pv2), inCavity(pv2))) : false) {
          const topY = cy + (fl * CY) / 2;
          const rc = Math.random();
          if (rc < 0.48) {          // 처마형(2단 — 넓은 박공 슬래브 위에 좁은 용마루)
            caps.push({ x: cx, y: topY + 0.13, z: cz, sx: sx * 1.36, sy: 0.22, sz: sz * 1.36 });
            caps.push({ x: cx, y: topY + 0.42, z: cz, sx: sx * 1.12, sy: 0.32, sz: sz * 1.12 });
          } else if (rc < 0.8) {    // 옥상 파라펫형(가장자리 낮은 난간벽)
            caps.push({ x: cx, y: topY + 0.24, z: cz, sx: sx * 1.06, sy: 0.5, sz: sz * 1.06 });
          }
        }
        if (expDir && expDir.y === 0 && Math.random() < 0.32)
          balconies.push({ x: pv.x, y: cy + rng(-CY * 0.2, CY * 0.2), z: pv.z, dx: expDir.x, dz: expDir.z });
        j += fl;
      }
    }
    const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
    const qFlip = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI);
    ([1, 2, 3] as const).forEach((fl) => {
      const list = towerBuckets[fl];
      const texes = facadeTexes[fl];
      const per = Math.ceil(list.length / texes.length);
      texes.forEach((tex, ti) => {
        const chunk = list.slice(ti * per, (ti + 1) * per);
        if (!chunk.length) return;
        const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
        const im = new THREE.InstancedMesh(box, mat, chunk.length);
        chunk.forEach((r, kk) => {
          sc.set(r.sx, r.sy, r.sz); m4.compose(_sv.set(r.x, r.y, r.z), r.rot ? qFlip : q0, sc);
          im.setMatrixAt(kk, m4); im.setColorAt(kk, col.setRGB(r.warm, r.warm * 0.92, r.warm * 0.8));
        });
        scene.add(im); disposables.push(mat, im);
      });
    });
    // 고란(高欄) 난간 파츠 — 大川荘(무한성 실제 모델)·원작 레퍼런스: 촘촘한 세로 동자살 +
    // 상단 횡목 + 가는 중간살대 + 끝기둥(보주 캡). 테라스·교량이 같은 문법을 공유한다.
    const railParts: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    function railingRun(cx: number, deckTop: number, cz: number, alongX: boolean, L: number) {
      railParts.push({ x: cx, y: deckTop + 0.58, z: cz, sx: alongX ? L : 0.1, sy: 0.09, sz: alongX ? 0.1 : L });      // 횡목
      railParts.push({ x: cx, y: deckTop + 0.3, z: cz, sx: alongX ? L : 0.05, sy: 0.05, sz: alongX ? 0.05 : L });     // 중간살대
      const n = Math.max(2, Math.round(L / 0.55));                                                                    // 동자살(촘촘)
      for (let i = 0; i < n; i++) {
        const off = -L / 2 + ((i + 0.5) * L) / n;
        railParts.push({ x: cx + (alongX ? off : 0), y: deckTop + 0.29, z: cz + (alongX ? 0 : off), sx: 0.06, sy: 0.55, sz: 0.06 });
      }
      for (const e of [-1, 1]) {                                                                                      // 끝기둥 + 보주 캡
        railParts.push({ x: cx + (alongX ? (e * L) / 2 : 0), y: deckTop + 0.34, z: cz + (alongX ? 0 : (e * L) / 2), sx: 0.12, sy: 0.7, sz: 0.12 });
        railParts.push({ x: cx + (alongX ? (e * L) / 2 : 0), y: deckTop + 0.75, z: cz + (alongX ? 0 : (e * L) / 2), sx: 0.18, sy: 0.12, sz: 0.18 });
      }
    }
    // 테라스 — 공동에 면한 벽의 돌출 마루(원작: 건물 끝 툇마루마다 고란 난간)
    if (balconies.length) {
      const bMat = new THREE.MeshBasicMaterial({ color: 0x4a2f12, fog: true });
      const bIm = new THREE.InstancedMesh(box, bMat, balconies.length);
      balconies.forEach((b, kk) => {
        const w = (b.dx !== 0 ? CZ : CX) * 0.95;                       // 벽면 방향 폭(거의 한 칸)
        const dcx = b.x + b.dx * (CX / 2 + 0.72), dcz = b.z + b.dz * (CZ / 2 + 0.72);
        sc.set(b.dx !== 0 ? 1.45 : w, 0.2, b.dz !== 0 ? 1.45 : w);
        m4.compose(_sv.set(dcx, b.y, dcz), q0, sc);
        bIm.setMatrixAt(kk, m4);
        // 바깥 가장자리에 고란 난간(테라스의 정면)
        railingRun(dcx + b.dx * 0.62, b.y + 0.1, dcz + b.dz * 0.62, b.dz !== 0, w);
      });
      scene.add(bIm); disposables.push(bMat, bIm);
    }
    if (caps.length) {
      const cMat = new THREE.MeshBasicMaterial({ color: 0x2a1a0c, fog: true });
      const cIm = new THREE.InstancedMesh(box, cMat, caps.length);
      caps.forEach((c, kk) => {
        sc.set(c.sx, c.sy, c.sz);
        m4.compose(_sv.set(c.x, c.y, c.z), q0, sc);
        cIm.setMatrixAt(kk, m4);
      });
      scene.add(cIm); disposables.push(cMat, cIm);
    }
    // 다다미 마루섬 — 부서 클러스터 아래 '부서 마루' + 공동에 떠 있는 방(발광 바닥이 어둠에 뜨는 시그니처)
    const tatamiTex = makeTatamiTexture(); disposables.push(tatamiTex);
    const platSide = new THREE.MeshBasicMaterial({ color: 0x211307, fog: true });
    const platTop = new THREE.MeshBasicMaterial({ map: tatamiTex, fog: true });
    disposables.push(platSide, platTop);
    const platMats = [platSide, platSide, platTop, platSide, platSide, platSide];
    const platformTops: { x: number; y: number; z: number }[] = [];
    const addPlatform = (px: number, py: number, pz: number, w: number, d: number, yaw: number, tilt: number) => {
      const m = new THREE.Mesh(box, platMats);
      m.position.set(px, py, pz); m.scale.set(w, 0.55, d); m.rotation.set(tilt, yaw, tilt * 0.6);
      scene.add(m);
      platformTops.push({ x: px, y: py + 0.28, z: pz });   // 중앙 상면(기울기 영향 최소 지점)
    };
    groupsArr.forEach((g) => addPlatform(g.pos.x, g.pos.y - g.pocketR * 0.62, g.pos.z, g.pocketR * 1.35, g.pocketR * 1.35, rng(0, Math.PI), rng(-0.05, 0.05)));
    // 등불 교량 — 수평 통로 구간을 실제 다리(상판+양측 난간+등불 연쇄)로 표현.
    // 원작의 '등불이 줄지어 늘어선 회랑·교량'이 공동을 가로지르는 시그니처를 재현한다.
    const bridgeLanterns: { x: number; y: number; z: number }[] = [];
    {
      const deckMat = new THREE.MeshBasicMaterial({ color: 0x2b1a0a, fog: true });
      disposables.push(deckMat);
      const horiz = corridorLegs.filter((l) => Math.abs(l.b.y - l.a.y) < 0.5 && l.a.distanceTo(l.b) > 14);
      let made = 0;
      for (const leg of horiz) {
        if (made >= 10) break;
        made++;
        const alongX = Math.abs(leg.b.x - leg.a.x) > Math.abs(leg.b.z - leg.a.z);
        const len = leg.a.distanceTo(leg.b);
        const L = len - len * 0.24;                       // 양끝 12% 여유(포켓 진입부 비움)
        const cxm = (leg.a.x + leg.b.x) / 2, cym = (leg.a.y + leg.b.y) / 2 - 2.6, czm = (leg.a.z + leg.b.z) / 2;
        const deck = new THREE.Mesh(box, deckMat);
        deck.position.set(cxm, cym, czm);
        deck.scale.set(alongX ? L : 2.4, 0.26, alongX ? 2.4 : L);
        scene.add(deck);
        const deckTop = cym + 0.13;
        for (const side of [-1, 1]) {
          railingRun(cxm + (alongX ? 0 : side * 1.16), deckTop, czm + (alongX ? side * 1.16 : 0), alongX, L);
          // 하부 지지보(세로 보 2줄) — 공중부양 대신 구조가 있는 다리로
          railParts.push({
            x: cxm + (alongX ? 0 : side * 0.78), y: cym - 0.27, z: czm + (alongX ? side * 0.78 : 0),
            sx: alongX ? L * 1.03 : 0.24, sy: 0.26, sz: alongX ? 0.24 : L * 1.03,
          });
        }
        const nL = Math.max(2, Math.floor(L / 7));        // 등불 연쇄 — 좌우 번갈아 줄지어
        for (let li = 0; li <= nL; li++) {
          const off = -L / 2 + (li / nL) * L;
          const side = li % 2 ? 1 : -1;
          bridgeLanterns.push({
            x: cxm + (alongX ? off : side * 1.16),
            y: cym + 1.08,                                   // 횡목 위에 올라앉는 높이(고란 난간과 정합)
            z: czm + (alongX ? side * 1.16 : off),
          });
        }
      }
    }
    if (railParts.length) {
      const rMat = new THREE.MeshBasicMaterial({ color: 0x6d4517, fog: true });
      const rIm = new THREE.InstancedMesh(box, rMat, railParts.length);
      railParts.forEach((r, kk) => {
        sc.set(r.sx, r.sy, r.sz);
        m4.compose(_sv.set(r.x, r.y, r.z), q0, sc);
        rIm.setMatrixAt(kk, m4);
      });
      scene.add(rIm); disposables.push(rMat, rIm);
    }
    // 등불 구조물 — 발코니·처마 밑에 매달린 초롱과 마루 위 행등. 빛이 물리적 출처(등)를 갖는다
    // (허공에 뜬 광구는 이질적이라는 피드백 반영 — 글로우는 반드시 등 몸통에 붙는다).
    function makeLanternTexture() {
      const cv = document.createElement("canvas"); cv.width = 32; cv.height = 48;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#1a0f06"; g.fillRect(0, 0, 32, 48);                 // 위·아래 갓
      const gr = g.createLinearGradient(0, 5, 0, 43);
      gr.addColorStop(0, "#ffd79a"); gr.addColorStop(0.5, "#ffbe6a"); gr.addColorStop(1, "#e08a30");
      g.fillStyle = gr; g.fillRect(2, 5, 28, 38);                        // 몸통(따뜻한 화지)
      g.strokeStyle = "rgba(70,38,10,0.75)"; g.lineWidth = 1.5;
      g.beginPath();
      for (let r = 1; r < 5; r++) { g.moveTo(2, 5 + r * 7.6); g.lineTo(30, 5 + r * 7.6); } // 초롱 살
      g.moveTo(16, 5); g.lineTo(16, 43);
      g.stroke();
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    const lanternTex = makeLanternTexture(); disposables.push(lanternTex);
    const lanterns: { x: number; y: number; z: number; rod: number }[] = [];
    for (const bcn of balconies) if (Math.random() < 0.4 && lanterns.length < 110)
      lanterns.push({ x: bcn.x + bcn.dx * (CX / 2 + 0.55), y: bcn.y - 0.85, z: bcn.z + bcn.dz * (CZ / 2 + 0.55), rod: 0.55 });
    for (const c of caps) if (Math.random() < 0.28 && lanterns.length < 130)
      lanterns.push({ x: c.x + c.sx * 0.42, y: c.y - 0.75, z: c.z + c.sz * 0.42, rod: 0.5 });
    for (const pt of platformTops) if (lanterns.length < 150)
      lanterns.push({ x: pt.x, y: pt.y + 0.62, z: pt.z, rod: -0.55 });   // 행등(마루에서 받침대로 세움)
    for (const bl of bridgeLanterns) if (lanterns.length < 230)
      lanterns.push({ x: bl.x, y: bl.y, z: bl.z, rod: -0.45 });          // 교량 난간 등불 연쇄
    const glowSprites: THREE.Sprite[] = [];
    if (lanterns.length) {
      const bodyMat = new THREE.MeshBasicMaterial({ map: lanternTex, fog: true });
      const bodyIm = new THREE.InstancedMesh(box, bodyMat, lanterns.length);
      const rodMat = new THREE.MeshBasicMaterial({ color: 0x140c05, fog: true });
      const rodIm = new THREE.InstancedMesh(box, rodMat, lanterns.length);
      const glowTexL = (() => {
        const cv = document.createElement("canvas"); cv.width = cv.height = 64;
        const g = cv.getContext("2d")!;
        const rad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
        rad.addColorStop(0, "rgba(255,235,200,0.9)");
        rad.addColorStop(0.3, "rgba(255,200,120,0.42)");
        rad.addColorStop(1, "rgba(255,170,80,0)");
        g.fillStyle = rad; g.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      disposables.push(glowTexL, bodyMat, bodyIm, rodMat, rodIm);
      lanterns.forEach((L, kk) => {
        sc.set(0.44, 0.62, 0.44); m4.compose(_sv.set(L.x, L.y, L.z), q0, sc); bodyIm.setMatrixAt(kk, m4);
        // rod>0: 위에 매달림(처마·발코니), rod<0: 아래 받침(마루 행등)
        sc.set(0.06, Math.abs(L.rod), 0.06);
        m4.compose(_sv.set(L.x, L.y + (L.rod > 0 ? 0.31 + L.rod / 2 : -(0.31 + Math.abs(L.rod) / 2)), L.z), q0, sc);
        rodIm.setMatrixAt(kk, m4);
        const mat = new THREE.SpriteMaterial({ map: glowTexL, color: 0xffb45e, transparent: true, opacity: rng(0.3, 0.5), blending: THREE.AdditiveBlending, depthWrite: false });
        const sp = new THREE.Sprite(mat);
        sp.position.set(L.x, L.y, L.z);
        const s0 = rng(1.5, 2.3); sp.scale.setScalar(s0);
        sp.userData.s0 = s0; sp.userData.ph = Math.random() * Math.PI * 2;
        scene.add(sp); glowSprites.push(sp); disposables.push(mat);
      });
      scene.add(bodyIm, rodIm);
    }
    for (let n = 0; n < 10; n++) {
      const c = cavities[(Math.random() * cavities.length) | 0];
      if (c.t === "ell") addPlatform(c.c.x + rng(-0.55, 0.55) * c.r.x, c.c.y + rng(-0.6, 0.6) * c.r.y, c.c.z + rng(-0.55, 0.55) * c.r.z, rng(5, 11), rng(5, 11), rng(0, Math.PI), rng(-0.12, 0.12));
      else { const tt = Math.random(); addPlatform(c.a.x + (c.b.x - c.a.x) * tt, c.a.y + (c.b.y - c.a.y) * tt + rng(-2.2, 2.2), c.a.z + (c.b.z - c.a.z) * tt, rng(4, 8), rng(4, 8), rng(0, Math.PI), rng(-0.12, 0.12)); }
    }

    // 업무 노드 큐브 — 그룹(본부)색 솔리드 + emissive. promoted 밝게 / candidate 흐리게
    type Cube = { mesh: THREE.Mesh; edge: THREE.LineSegments; task: MapTask; group: string; hue: number; baseScale: number; promoted: boolean };
    const cubes: Cube[] = [];
    const cubeByTask = new Map<string, number>();
    for (const g of groupsArr) {
      for (const t of g.tasks) {
        const s = t.org === "현업" ? rng(2.4, 2.9) : rng(2.9, 3.6); // 현업(집행)은 약간 작게 — 정책/집행 층 구분
        const promoted = t.status === "promoted";
        const mat = new THREE.MeshStandardMaterial({ color: g.hue, roughness: 0.62, metalness: 0.05, emissive: g.hue, emissiveIntensity: promoted ? 0.55 : 0.4 });
        const mesh = new THREE.Mesh(box, mat);
        mesh.position.copy(layout.taskPos.get(t.id)!);
        mesh.scale.setScalar(s);
        const eMat = new THREE.LineBasicMaterial({ color: new THREE.Color(g.hue).lerp(new THREE.Color(0xffffff), promoted ? 0.35 : 0.15), transparent: true, opacity: promoted ? 0.9 : 0.5 });
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box), eMat);
        mesh.add(edge);
        mesh.userData.idx = cubes.length;
        scene.add(mesh);
        cubeByTask.set(t.id, cubes.length);
        cubes.push({ mesh, edge, task: t, group: g.key, hue: g.hue, baseScale: s, promoted });
        disposables.push(mat, eMat, edge.geometry);
      }
    }

    // 연결선: 부서 내 업무 체인(intra) + 공유근거 협업(cross)
    function makeLines(pairs: [number, number][], color: number, opacity: number) {
      const pos: number[] = [];
      pairs.forEach(([a, b]) => {
        const A = cubes[a]?.mesh.position, B = cubes[b]?.mesh.position;
        if (A && B) pos.push(A.x, A.y, A.z, B.x, B.y, B.z);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
      const l = new THREE.LineSegments(g, mat);
      scene.add(l); disposables.push(g, mat);
      return l;
    }
    const intraPairs: [number, number][] = [];
    groupsArr.forEach((g) => {
      const idx = g.tasks.map((t) => cubeByTask.get(t.id)!).filter((n) => n != null);
      for (let k = 0; k < idx.length - 1; k++) intraPairs.push([idx[k], idx[k + 1]]);
    });
    const crossPairs: [number, number][] = [];
    for (const cl of data.crossLinks) {
      const ids = cl.tasks.map((t) => cubeByTask.get(t)).filter((n): n is number => n != null);
      for (let k = 0; k < ids.length - 1 && k < 6; k++) crossPairs.push([ids[k], ids[k + 1]]); // 사슬로(클리크 폭발 방지)
    }
    // 선행(본사 정책→현업 집행) — 포켓을 가로지르는 정책-집행 빛줄기
    for (const [a, b] of data.precedes ?? []) {
      const ia = cubeByTask.get(a), ib = cubeByTask.get(b);
      if (ia != null && ib != null) crossPairs.push([ia, ib]);
    }
    const intraLines = makeLines(intraPairs, 0xffd08a, 0.28);
    const crossLines = makeLines(crossPairs, 0x7fe0cc, 0.2);

    // 카메라: 90° 스냅 + 원경 진입 + 통로 탐험
    const goalQ = new THREE.Quaternion(); const curQ = goalQ.clone();
    let goalR = 205, curR = 245; const R_MIN = 6, R_MAX = 240;
    const goalTarget = new THREE.Vector3(0, 0, 0), curTarget = new THREE.Vector3(0, 0, 0);
    const LX = new THREE.Vector3(1, 0, 0), LY = new THREE.Vector3(0, 1, 0);
    const dq = new THREE.Quaternion();
    const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2(-2, -2); const tipXY = { x: 0, y: 0 };
    let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = 0, accX = 0, accY = 0;
    const TURN = Math.PI / 2, TURN_PX = 64;
    let selected: number | null = null;
    let tour: { leg: number; t: number } | null = null;
    const legLen = corridorLegs.map((l) => l.a.distanceTo(l.b));

    const rectXY = (cx: number, cy: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * 2 - 1, y: -((cy - r.top) / r.height) * 2 + 1 };
    };
    const notifyTour = (v: boolean) => setTouring(v);
    function stopTourNow() { if (tour) { tour = null; notifyTour(false); } }
    function userAct() { lastInteract = performance.now(); stopTourNow(); }
    const onDown = (e: PointerEvent) => { dragging = true; moved = 0; accX = 0; accY = 0; lastX = e.clientX; lastY = e.clientY; userAct(); };
    const onMove = (e: PointerEvent) => {
      const n = rectXY(e.clientX, e.clientY); mouse.x = n.x; mouse.y = n.y;
      const r = canvas.getBoundingClientRect(); tipXY.x = e.clientX - r.left; tipXY.y = e.clientY - r.top;
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy); accX += dx; accY += dy;
      while (accX <= -TURN_PX) { goalQ.multiply(dq.setFromAxisAngle(LY, -TURN)); accX += TURN_PX; }
      while (accX >= TURN_PX) { goalQ.multiply(dq.setFromAxisAngle(LY, TURN)); accX -= TURN_PX; }
      while (accY <= -TURN_PX) { goalQ.multiply(dq.setFromAxisAngle(LX, -TURN)); accY += TURN_PX; }
      while (accY >= TURN_PX) { goalQ.multiply(dq.setFromAxisAngle(LX, TURN)); accY -= TURN_PX; }
      userAct();
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); goalR = Math.min(R_MAX, Math.max(R_MIN, goalR * (1 + Math.sign(e.deltaY) * 0.1))); userAct(); };
    const onClick = (e: MouseEvent) => {
      if (moved > 6) return;
      const n = rectXY(e.clientX, e.clientY);
      raycaster.setFromCamera(new THREE.Vector2(n.x, n.y), camera);
      const h = raycaster.intersectObjects(cubes.map((c) => c.mesh), false)[0];
      if (h) select((h.object as THREE.Object3D).userData.idx); else deselect();
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("click", onClick);

    let tourAge = 0; // 탐색 경과
    let tourEase = 1; // 구간 이징(코너 감속 ↔ 직선 가속) — frame 감쇠 계수와 공유
    let diveV = 0; // 낙하 속도(무한성식 자유낙하 줌인)
    function startTourNow(force = false) {
      if ((reduced && !force) || !corridorLegs.length) return;
      if (selected != null) { selected = null; applyStyles(); onSelectTask?.(null); }
      tour = { leg: Math.floor(Math.random() * corridorLegs.length), t: 0 };
      tourAge = 0;
      diveV = 0;
      legV = 0;
      notifyTour(true);
    }
    const dirV = new THREE.Vector3(), lookM = new THREE.Matrix4(), upV = new THREE.Vector3();
    let legV = 0; // 구간 진행 속도(유닛/s) — 정렬됐을 때만 중력 가속(낙하), 코너·회전 중 저속
    let align = 1; // 회전 정렬도(0=크게 회전 중, 1=진행 방향 정면) — 빠름은 정렬 후에만
    function tourStep(dt: number) {
      if (!tour) return;
      tourAge += dt;
      const leg = corridorLegs[tour.leg];
      dirV.subVectors(leg.b, leg.a).normalize();
      const vertical = Math.abs(dirV.y) > 0.9;
      if (vertical) {
        // 낙하 구간 — 정면 정렬됐을 때만 중력 가속 폭주, 회전 중엔 기어가듯
        legV = Math.min(110, legV + dt * 300 * align * align);
        if (align < 0.55) legV = Math.min(legV, 9);
        tourEase = 1; // 낙하 중엔 시선·타깃 추적도 최대 민첩
      } else {
        // 수평 순항 — 코너 감속 ↔ 직선 가속(sin 이징), 회전 중엔 감속
        const ease = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0, tour.t)));
        tourEase = ease;
        legV += (13 * ease * (0.25 + 0.75 * align) - legV) * Math.min(1, dt * 6);
      }
      tour.t += (dt * legV) / Math.max(1, legLen[tour.leg]);
      if (tour.t >= 1) {
        tour.leg = (tour.leg + 1) % corridorLegs.length; tour.t = 0;
        legV *= 0.22; // 코너 급제동(스냅) 후 재가속
        return;
      }
      goalTarget.lerpVectors(leg.a, leg.b, tour.t);
      upV.set(0, 1, 0); if (vertical) upV.set(0, 0, dirV.y > 0 ? 1 : -1);
      lookM.lookAt(new THREE.Vector3(0, 0, 0), dirV, upV);
      goalQ.setFromRotationMatrix(lookM); goalR = 2.6;
    }

    // 필터·검색 상태(씬 내부, React가 ctrl로 주입)
    let fGroup: string | null = null, fQuery = "";
    function matchedIdx(): number[] {
      if (!fQuery) return [];
      return cubes.map((c, i) => ({ c, i })).filter(({ c }) => c.task.label.includes(fQuery) || c.task.dept.includes(fQuery) || (c.task.fn || "").includes(fQuery)).map((x) => x.i);
    }
    function applyStyles() {
      const matches = new Set(matchedIdx());
      cubes.forEach((c, i) => {
        let on = true;
        if (fGroup && c.group !== fGroup) on = false;
        if (fQuery && !matches.has(i)) on = false;
        const sel = selected === i;
        const base = c.promoted ? 0.62 : 0.42;
        c.mesh.material instanceof THREE.MeshStandardMaterial &&
          (c.mesh.material.emissiveIntensity = sel ? 1.2 : on ? (fQuery || fGroup ? 0.95 : base) : 0.06);
        (c.mesh.material as THREE.MeshStandardMaterial).color.setHex(on || sel ? c.hue : 0x2a241c);
        (c.edge.material as THREE.LineBasicMaterial).opacity = sel ? 1 : on ? (c.promoted ? 0.9 : 0.5) : 0.12;
      });
      const dim = !!(fGroup || fQuery);
      (intraLines.material as THREE.LineBasicMaterial).opacity = dim ? 0.08 : 0.28;
      (crossLines.material as THREE.LineBasicMaterial).opacity = dim ? 0.06 : 0.2;
    }
    function select(i: number) {
      userAct(); selected = i;
      goalTarget.copy(cubes[i].mesh.position); goalR = 10;
      applyStyles();
      onSelectTask?.(cubes[i].task.id);
    }
    function deselect() { selected = null; goalR = Math.max(goalR, 10); applyStyles(); onSelectTask?.(null); }

    ctrl.current = {
      setFilter: (g, q) => { fGroup = g; fQuery = q; applyStyles(); },
      selectMatch: () => { const m = matchedIdx(); if (m.length >= 1) select(m[0]); },
      focusDept: (g) => {
        if (g) { const p = groupByKey.get(g); if (p) { goalTarget.copy(p.pos); goalR = Math.max(12, p.pocketR + 3); } }
        else { goalTarget.set(0, 0, 0); goalR = 175; }
        userAct();
      },
      startTour: () => startTourNow(true),
      stopTour: () => { lastInteract = performance.now(); stopTourNow(); },
      selectTask: (id) => { const i = cubeByTask.get(id); if (i != null) select(i); },
    };
    // 지식검색 → 관련 업무 카드 클릭 시 카메라 선택(축간 왕복 배선)
    const onExternalSelect = (e: Event) => {
      const id = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      if (id) { const i = cubeByTask.get(id); if (i != null) select(i); }
    };
    window.addEventListener("axp-work-select", onExternalSelect);

    // 라벨 DOM(그룹명) — 위치는 루프에서 갱신
    const labelEls: HTMLDivElement[] = [];
    if (labelsRef.current) {
      labelsRef.current.innerHTML = "";
      groupsArr.forEach((g) => {
        const el = document.createElement("div");
        el.className = "wx-label";
        el.style.color = "#" + g.hue.toString(16).padStart(6, "0");
        el.innerHTML = `${g.label}<small>업무 ${g.tasks.length}</small>`;
        labelsRef.current!.appendChild(el);
        labelEls.push(el);
      });
    }

    const proj = new THREE.Vector3(), camOff = new THREE.Vector3();
    let raf = 0, tPrev = performance.now(), hovered: THREE.Object3D | null = null;
    function resize() {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();

    function frame(now: number) {
      const dt = Math.min(0.12, (now - tPrev) / 1000); tPrev = now;
      if (!tour && !reduced && !dragging && now - lastInteract > 5000 && selected == null) startTourNow();
      // 회전 정렬 게이트 — 방향 전환(회전) 중엔 느리게, 진행 방향 정면 정렬 후에만 폭주
      align = tour ? 1 - Math.min(1, curQ.angleTo(goalQ) / 0.6) : 1;
      if (tour) tourStep(dt);
      // 무한성식 낙하 — ①진입: 자유낙하 줌인(중력 가속→스냅 정지) ②수직 통로: legV 폭주(벽 스침).
      // FOV·감쇠는 실제 속도(diveV·legV) 연동 — 빠를수록 광각·민첩. 가속은 정렬(align) 후에만.
      const falling = tour && curR > goalR + 1.5;
      diveV = falling ? Math.min(520, diveV + dt * 900 * align * align) : 0;
      if (falling && align < 0.55) diveV = Math.min(diveV, 55);
      const speedNorm = Math.min(1, Math.max(diveV / 520, legV / 110));
      const kQ = 1 - Math.exp(-dt * (tour ? 1.8 + 2.6 * tourEase + 6.0 * speedNorm : 5.0));
      const kT = 1 - Math.exp(-dt * (tour ? 2.4 + 2.2 * tourEase + 9.0 * speedNorm : 4.2));
      curQ.slerp(goalQ, kQ);
      if (falling) curR = Math.max(goalR, curR - diveV * dt);
      else { const kR = 1 - Math.exp(-dt * (tour ? 4.5 + 2.4 * tourEase : 4.2)); curR += (goalR - curR) * kR; }
      curTarget.lerp(goalTarget, kT);
      // 낙하 속도감 — 광각 킥(고속에서 시야가 벌어졌다가 정지 시 복귀)
      const targetFov = 58 + 26 * speedNorm;
      if (Math.abs(camera.fov - targetFov) > 0.2) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
      camOff.set(0, 0, curR).applyQuaternion(curQ); camera.position.copy(curTarget).add(camOff); camera.quaternion.copy(curQ);
      const fog = scene.fog as THREE.Fog; fog.near = 24 + curR * 0.5; fog.far = Math.max(120, curR * 2.4);

      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects(cubes.map((c) => c.mesh), false)[0];
      const nh = hit ? hit.object : null;
      if (nh !== hovered) {
        hovered = nh;
        canvas.style.cursor = nh ? "pointer" : "grab";
        const tip = tipRef.current;
        if (tip) {
          if (nh) {
            const c = cubes[(nh as THREE.Object3D).userData.idx];
            tip.innerHTML = `<b>${c.task.label}</b> · ${c.task.dept}${c.task.org === "현업" ? ' <em style="opacity:.85;color:#7fe0cc">현장</em>' : ""}${c.promoted ? "" : ' <em style="opacity:.7">· 검토중</em>'}`;
            tip.classList.add("show");
          } else tip.classList.remove("show");
        }
        applyStyles();
      }
      const tip = tipRef.current;
      if (tip && tip.classList.contains("show")) { tip.style.left = tipXY.x + 14 + "px"; tip.style.top = tipXY.y + 12 + "px"; }

      cubes.forEach((c, i) => { const pl = (!reduced && selected === i) ? 1 + Math.sin(now * 0.004) * 0.035 : 1; c.mesh.scale.setScalar(c.baseScale * pl); });
      if (!reduced) for (const sp of glowSprites) { const s0 = sp.userData.s0 as number; sp.scale.setScalar(s0 * (1 + 0.09 * Math.sin(now * 0.0012 + (sp.userData.ph as number)))); }

      const labelsVisible = curR < 150; // 원경(진입)에선 라벨 숨김 — 겹침 방지, 줌인 시 등장
      groupsArr.forEach((g, i) => {
        const el = labelEls[i]; if (!el) return;
        if (!labelsVisible) { el.style.display = "none"; return; }
        proj.copy(g.pos); proj.y += g.pocketR + 3; proj.project(camera);
        const vis = proj.z < 1;
        el.style.display = vis ? "block" : "none";
        if (vis) { el.style.left = (proj.x * 0.5 + 0.5) * wrap.clientWidth + "px"; el.style.top = (-proj.y * 0.5 + 0.5) * wrap.clientHeight + "px"; }
      });

      composer.render();
      // 디버그 계기(개발 확인용) — DOM dataset은 확장 격리월드에서도 읽힘
      canvas.dataset.wx = `r=${curR.toFixed(1)} dive=${diveV.toFixed(0)} leg=${legV.toFixed(0)} fov=${camera.fov.toFixed(1)} tour=${tour ? 1 : 0}`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    applyStyles();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      composer.dispose?.();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("axp-work-select", onExternalSelect);
      ctrl.current = null;
      setTouring(false);
      for (const d of disposables) { try { d.dispose(); } catch { /* noop */ } }
      renderer.dispose();
    };
  }, [data, onSelectTask]);

  // React 필터 → 씬
  useEffect(() => { ctrl.current?.setFilter(activeGroup, query.trim()); }, [activeGroup, query]);

  if (err) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0705] text-amber-100/80">
        <div className="text-center">
          <p className="text-sm">{err}</p>
          <p className="mt-1 text-xs text-amber-100/50">3D 업무탐색을 표시할 수 없습니다. 상단에서 「지식검색」으로 전환해 이용하세요.</p>
        </div>
      </div>
    );
  }

  // 그룹 칩(기능 도메인 6) — 씬 배치와 동일 규칙, 업무 수 내림차순
  const groupChips = (() => {
    if (!data) return [];
    const cnt = new Map<string, number>();
    for (const t of data.tasks) { const g = t.fn?.split(">")[0]?.trim() || "기타"; cnt.set(g, (cnt.get(g) ?? 0) + 1); }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n }));
  })();

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#0a0705]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ touchAction: "none" }} />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />
      <div ref={tipRef} className="wx-tip" />

      {/* 상단 검색·필터 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 p-3">
        <div className="pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border-2 border-amber-500/70 bg-[#f7ecd6]/95 px-4 py-2 shadow-lg backdrop-blur">
          <span className="material-symbols-outlined text-amber-700" style={{ fontSize: 19 }}>search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") ctrl.current?.selectMatch(); if (e.key === "Escape") setQuery(""); }}
            placeholder="업무·부서 검색 (Enter로 이동)"
            className="w-full bg-transparent text-sm font-medium text-stone-900 placeholder:text-stone-500 outline-none"
          />
          {!!data && <span className="whitespace-nowrap text-[11px] font-bold text-amber-800/80">업무 {data.stats.tasks}</span>}
        </div>
        <div className="pointer-events-auto mx-auto flex max-w-full flex-wrap justify-center gap-1.5">
          <button
            onClick={() => { setActiveGroup(null); ctrl.current?.focusDept(null); }}
            className={`rounded-full border-2 px-3 py-1 text-[12px] font-bold shadow transition ${!activeGroup ? "border-amber-600 bg-amber-600 text-white" : "border-amber-500/50 bg-[#f7ecd6]/90 text-stone-700 hover:bg-[#f7ecd6]"}`}
          >전체</button>
          {groupChips.map((g) => (
            <button
              key={g.key}
              onClick={() => { const ng = activeGroup === g.key ? null : g.key; setActiveGroup(ng); ctrl.current?.focusDept(ng); }}
              className={`rounded-full border-2 px-3 py-1 text-[12px] font-bold shadow transition ${activeGroup === g.key ? "border-amber-600 bg-amber-600 text-white" : "border-amber-500/50 bg-[#f7ecd6]/90 text-stone-700 hover:bg-[#f7ecd6]"}`}
            >{g.key} <span className={activeGroup === g.key ? "opacity-80" : "text-stone-500"}>{g.n}</span></button>
          ))}
        </div>
      </div>

      {/* 탐색 시작/멈춤 — 하단 중앙 */}
      {!!data && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <button
            onClick={() => (touring ? ctrl.current?.stopTour() : ctrl.current?.startTour())}
            className={`pointer-events-auto rounded-full border px-5 py-2 text-sm font-bold shadow-lg backdrop-blur transition ${
              touring
                ? "border-amber-200/30 bg-black/50 text-amber-200/80 hover:bg-black/70"
                : "border-amber-300/60 bg-amber-500/25 text-amber-50 hover:bg-amber-500/40"
            }`}
          >{touring ? "⏹ 탐색 멈춤" : "▶ 업무탐색 시작"}</button>
        </div>
      )}

      {/* 도메인 업무 리스트 — 칩 선택 시 우측 표출 */}
      {!!data && activeGroup && (() => {
        const hue = "#" + (DOMAIN_HUES[activeGroup] ?? 0xe0a04a).toString(16).padStart(6, "0");
        const inDomain = data.tasks.filter((t) => (t.fn?.split(">")[0]?.trim() || "기타") === activeGroup);
        const bySub = new Map<string, MapTask[]>();
        for (const t of inDomain) {
          const s = t.fn?.split(">")[1]?.trim() || "기타";
          (bySub.get(s) ?? bySub.set(s, []).get(s)!).push(t);
        }
        const subs = [...bySub.entries()].sort((a, b) => b[1].length - a[1].length);
        return (
          <aside className="absolute bottom-16 right-3 top-24 z-[5] flex w-80 flex-col overflow-hidden rounded-xl border-2 border-amber-600/60 bg-[#f9f1de]/95 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-2 border-b-2 px-3.5 py-2.5" style={{ borderColor: hue, background: `${hue}22` }}>
              <h3 className="flex items-center gap-1.5 text-[15px] font-extrabold text-stone-900">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: hue }} />
                {activeGroup} <span className="text-[11.5px] font-bold text-stone-500">업무 {inDomain.length}</span>
              </h3>
              <button onClick={() => { setActiveGroup(null); ctrl.current?.focusDept(null); }} className="rounded px-1.5 text-lg text-stone-500 hover:bg-black/10">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {subs.map(([sub, ts]) => (
                <div key={sub} className="mb-2">
                  <div className="px-1.5 pb-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-800">{sub} · {ts.length}</div>
                  {ts.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => ctrl.current?.selectTask(t.id)}
                      className="mb-0.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-amber-600/15"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-stone-800">{t.label}</span>
                      {t.org === "현업" && <span className="shrink-0 rounded bg-teal-600/15 px-1.5 py-0.5 text-[9.5px] font-extrabold text-teal-800">현장</span>}
                      <span className="shrink-0 text-[10.5px] font-medium text-stone-500">{t.dept.replace(/^지역본부 /, "")}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        );
      })()}

      {/* 로딩 */}
      {!data && !err && (
        <div className="absolute inset-0 flex items-center justify-center text-amber-100/70">
          <p className="text-sm">무한성 공간 구성 중…</p>
        </div>
      )}

      <style>{`
        .wx-label{position:absolute;transform:translate(-50%,-100%);font-size:12px;font-weight:700;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,.9);pointer-events:none}
        .wx-label small{display:block;font-size:9px;font-weight:500;opacity:.7;text-align:center}
        .wx-tip{position:absolute;display:none;z-index:5;padding:10px 18px;border-radius:14px;background:rgba(20,14,8,.94);border:1.5px solid rgba(240,200,120,.35);color:#f6e6c9;font-size:24px;line-height:1.3;pointer-events:none;white-space:nowrap;box-shadow:0 4px 18px rgba(0,0,0,.5)}
        .wx-tip.show{display:block}
      `}</style>
    </div>
  );
}
