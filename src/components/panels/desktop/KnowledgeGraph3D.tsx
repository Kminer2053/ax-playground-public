"use client";
/**
 * 지식그래프 3D — E 절충안(확정): 사규는 위계 지층(규정→세칙→지침→매뉴얼→편람→계약서) + 한지 카드,
 * 외부 법령·행정규칙은 물결 링으로 바깥을 감싼다. 가로형 패널 최적화.
 * highlight(답변 인용 문서 제목들) → 붉은 펄스 + 인용 문서 간 관계선(유형·방향 배지, 호버 시 근거문장).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type GraphData3D = {
  nodes: { id: string; cat: string }[];
  hier: [string, string][];
  ref: [string, string, number, string?, string?][];
  law?: [string, string, number, string?, string?][];
};

const BG = 0xfaf8f3;
const INK = "#2a2117";
const CAT_COLOR: Record<string, number> = {
  규정: 0xc9820e, 세칙: 0x0e9678, 지침: 0x3568b8, 편람: 0xc05c1a,
  매뉴얼: 0x7448c8, 계약서: 0xc23a63, 행정규칙: 0x9a6ad0, 법령: 0x8b97a8, 외부: 0x9aa4b2,
};
const EXTERNAL = new Set(["법령", "행정규칙", "외부"]);
const EVID = 0xe0342f;
const REL_COLOR: Record<string, number> = {
  근거: 0xb1281f, 위임: 0x3568b8, 준용적용: 0x0e9678, 정의: 0x7448c8,
  서식첨부: 0x9a8a6a, "제재·벌칙": 0x8a2a52, 절차: 0xc05c1a, 예외: 0x566073,
  "개정·시행": 0x557a3a, "상충·우선": 0xd1478a, "선후·전제": 0x6b6152,
  법령위임근거: 0x2a4f8a, 상위규범: 0x6b6152, 참조: 0x6b6152,
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Edge = { s: number; t: number; kind: "hier" | "ref" | "law"; w: number; rt: string; reason: string };
type SceneHandle = { setEvidence: (titles: string[]) => void; dispose: () => void };
type SceneCbs = { onInfo?: (s: string) => void; onSelectDoc?: (title: string | null) => void; onOpenDoc?: (title: string) => void };

function buildScene(container: HTMLDivElement, data: GraphData3D, cbs: () => SceneCbs): SceneHandle {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;";
  container.appendChild(canvas);
  const tip = document.createElement("div");
  tip.style.cssText =
    "position:absolute;z-index:20;pointer-events:none;opacity:0;transition:opacity .12s;padding:7px 11px;font-size:12.5px;max-width:340px;line-height:1.5;background:rgba(255,255,255,.97);color:#2a2117;border:1px solid rgba(42,33,23,.16);border-radius:8px;box-shadow:0 3px 12px rgba(42,33,23,.14);";
  container.appendChild(tip);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 340, 900);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
  camera.position.set(0, 68, 350);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;

  const G = data;
  const idIdx = new Map(G.nodes.map((n, i) => [n.id, i]));
  const N = G.nodes.length;
  const edgesAll: Edge[] = [
    ...G.hier.map(([s, t]) => ({ s: idIdx.get(s), t: idIdx.get(t), kind: "hier" as const, w: 1, rt: "상위규범", reason: "" })),
    ...G.ref.map(([s, t, w, rt, reason]) => ({ s: idIdx.get(s), t: idIdx.get(t), kind: "ref" as const, w: w || 1, rt: rt || "참조", reason: reason || "" })),
    ...(G.law || []).map(([s, t, w, rt, reason]) => ({ s: idIdx.get(s), t: idIdx.get(t), kind: "law" as const, w: w || 1, rt: rt || "근거", reason: reason || "" })),
  ].filter((e): e is Edge => e.s != null && e.t != null && e.s !== e.t);
  const nbr: Set<number>[] = Array.from({ length: N }, () => new Set());
  edgesAll.forEach((e) => { nbr[e.s].add(e.t); nbr[e.t].add(e.s); });

  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(d: T): T => { disposables.push(d); return d; };

  // ── 텍스처(흰 배경용 잉크 스타일) ──
  const discCache = new Map<string, THREE.CanvasTexture>();
  const discTex = (hex: number, ext = false) => {
    const key = hex + (ext ? "e" : "");
    const hit = discCache.get(key);
    if (hit) return hit;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d")!;
    g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fillStyle = "#" + hex.toString(16).padStart(6, "0");
    g.globalAlpha = ext ? 0.55 : 0.95; g.fill();
    g.globalAlpha = 1; g.lineWidth = 4;
    g.strokeStyle = ext ? "rgba(90,100,115,.55)" : "rgba(42,33,23,.6)";
    g.stroke();
    const t = track(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    discCache.set(key, t); return t;
  };
  const paperTex = (hex: number) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d")!;
    const c = "#" + hex.toString(16).padStart(6, "0");
    g.fillStyle = "#fffdf6"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = c; g.globalAlpha = 0.16; g.fillRect(0, 0, 128, 128); g.globalAlpha = 1;
    g.strokeStyle = c; g.lineWidth = 10; g.strokeRect(6, 6, 116, 116);
    g.globalAlpha = 0.22; g.lineWidth = 4;
    g.beginPath(); g.moveTo(64, 6); g.lineTo(64, 122); g.moveTo(6, 64); g.lineTo(122, 64); g.stroke();
    g.globalAlpha = 1;
    const t = track(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const FONT = "700 26px -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  const labelTex = (text: string) => {
    const t = text.length > 14 ? text.slice(0, 13) + "…" : text;
    const cv = document.createElement("canvas");
    const m = cv.getContext("2d")!;
    m.font = FONT;
    const w = Math.ceil(m.measureText(t).width) + 18;
    cv.width = w; cv.height = 38;
    const g = cv.getContext("2d")!;
    g.font = FONT; g.textBaseline = "middle";
    g.lineWidth = 7; g.lineJoin = "round"; g.strokeStyle = "rgba(250,248,243,.95)"; g.strokeText(t, 9, 20);
    g.fillStyle = INK; g.fillText(t, 9, 20);
    const tex = track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, aspect: w / 38 };
  };
  const pillCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
  const pillTex = (text: string, hex: number) => {
    const key = text + hex;
    const hit = pillCache.get(key);
    if (hit) return hit;
    const c = "#" + hex.toString(16).padStart(6, "0");
    const font = "800 26px -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
    const cv = document.createElement("canvas");
    const m = cv.getContext("2d")!;
    m.font = font;
    const w = Math.ceil(m.measureText(text).width) + 34, h = 44;
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d")!;
    g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, 18);
    g.fillStyle = "rgba(255,255,255,.97)"; g.fill();
    g.lineWidth = 3.5; g.strokeStyle = c; g.stroke();
    g.font = font; g.textBaseline = "middle"; g.textAlign = "center";
    g.fillStyle = c; g.fillText(text, w / 2, h / 2 + 1);
    const tex = track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    const out = { tex, aspect: w / h };
    pillCache.set(key, out); return out;
  };

  // ── E 레이아웃: 위계 지층 + 한지 카드 + 물결 링 ──
  const group = new THREE.Group();
  scene.add(group);
  const positions = new Float32Array(N * 3);
  const nodesArr: THREE.Object3D[] = [];
  const labelsArr: THREE.Sprite[] = [];
  const makeNode = (i: number, x: number, y: number, z: number, size: number) => {
    const cat = G.nodes[i].cat, ext = EXTERNAL.has(cat);
    const m = track(new THREE.SpriteMaterial({ map: discTex(CAT_COLOR[cat] ?? 0x888888, ext), transparent: true, depthWrite: false }));
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z); s.scale.setScalar(size);
    s.userData = { i, baseScale: size, ext };
    group.add(s); nodesArr.push(s);
  };
  const makeLabel = (i: number, x: number, y: number, z: number, nodeSize: number) => {
    const ext = EXTERNAL.has(G.nodes[i].cat);
    const { tex, aspect } = labelTex(G.nodes[i].id);
    const lm = track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const l = new THREE.Sprite(lm);
    l.center.set(0.5, 1.45);
    l.position.set(x, y, z);
    const lh = Math.max(3.6, nodeSize * 0.78);
    l.scale.set(lh * aspect, lh, 1);
    l.userData = { i, ext, baseH: lh, aspect };
    group.add(l); labelsArr.push(l);
  };
  const order = ["규정", "세칙", "지침", "매뉴얼", "편람", "계약서"].filter((c) => G.nodes.some((n) => n.cat === c));
  const layerGap = 26;
  const box = track(new THREE.BoxGeometry(1, 1, 1));
  let maxR = 0;
  order.forEach((cat, li) => {
    const idxs = G.nodes.map((_, i) => i).filter((i) => G.nodes[i].cat === cat);
    const y = (order.length / 2 - li) * layerGap;
    const R = 34 + Math.sqrt(idxs.length) * 17;
    maxR = Math.max(maxR, R);
    const diskG = track(new THREE.CircleGeometry(R, 64));
    const diskM = track(new THREE.MeshBasicMaterial({ color: CAT_COLOR[cat], transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    const disk = new THREE.Mesh(diskG, diskM);
    disk.rotation.x = -Math.PI / 2; disk.position.y = y; group.add(disk);
    const ringG = track(new THREE.RingGeometry(R - 0.7, R, 96));
    const ringM = track(new THREE.MeshBasicMaterial({ color: CAT_COLOR[cat], transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    const ring = new THREE.Mesh(ringG, ringM);
    ring.rotation.x = -Math.PI / 2; ring.position.y = y; group.add(ring);
    const ptex = paperTex(CAT_COLOR[cat]);
    idxs.forEach((i, k) => {
      const a = k * 2.39996, r = R * 0.18 + R * 0.74 * Math.sqrt((k + 0.5) / idxs.length);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      positions[i * 3] = x; positions[i * 3 + 1] = y + 3.4; positions[i * 3 + 2] = z;
      const m = track(new THREE.MeshBasicMaterial({ map: ptex, transparent: true }));
      const mesh = new THREE.Mesh(box, m);
      mesh.position.set(x, y + 3.4, z); mesh.scale.setScalar(6.8);
      mesh.userData = { i, baseScale: 6.8, ext: false };
      group.add(mesh); nodesArr.push(mesh);
      makeLabel(i, x, y - 1.8, z, 6.8);
    });
  });
  // 외부 규범 — B형 물결 링(법령 바깥, 행정규칙·외부 안쪽)
  ([["법령", maxR + 44], ["행정규칙", maxR + 22], ["외부", maxR + 22]] as [string, number][]).forEach(([cat, ringR], gi) => {
    const idxs = G.nodes.map((_, i) => i).filter((i) => G.nodes[i].cat === cat);
    idxs.forEach((i, k) => {
      const a = (k / Math.max(1, idxs.length)) * Math.PI * 2 + gi * 0.35;
      const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
      const y = Math.sin(a * 3) * 18;
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
      makeNode(i, x, y, z, 4.4);
      makeLabel(i, x, y, z, 4.4);
    });
  });
  // 기본 엣지(위계 앰버 · 참조 틸 · 법령 옅은 보라)
  const addEdgeLines = (list: Edge[], color: number, opacity: number) => {
    if (!list.length) return;
    const arr = new Float32Array(list.length * 6);
    list.forEach((e, k) =>
      arr.set([positions[e.s * 3], positions[e.s * 3 + 1], positions[e.s * 3 + 2], positions[e.t * 3], positions[e.t * 3 + 1], positions[e.t * 3 + 2]], k * 6));
    const g = track(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const m = track(new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    group.add(new THREE.LineSegments(g, m));
  };
  addEdgeLines(edgesAll.filter((e) => e.kind === "hier"), 0xc9820e, 0.36);
  addEdgeLines(edgesAll.filter((e) => e.kind === "ref"), 0x2e8f76, 0.22);
  addEdgeLines(edgesAll.filter((e) => e.kind === "law"), 0x9a8ab8, 0.16);

  // ── 근거 강조: 인용 문서 간 관계선 오버레이 ──
  let evidenceSet: Set<number> | null = null;
  let relPills: THREE.Sprite[] = [];
  let relGroup: THREE.Group | null = null;
  const relDisposables: { dispose: () => void }[] = [];
  const clearRelOverlay = () => {
    if (relGroup) group.remove(relGroup);
    relDisposables.forEach((d) => { try { d.dispose(); } catch { /* noop */ } });
    relDisposables.length = 0;
    relGroup = null; relPills = [];
  };
  const trackRel = <T extends { dispose: () => void }>(d: T): T => { relDisposables.push(d); return d; };
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  const buildRelOverlay = () => {
    clearRelOverlay();
    if (!evidenceSet) return;
    const rg = new THREE.Group();
    const cylGeo = trackRel(new THREE.CylinderGeometry(0.55, 0.55, 1, 8));
    const coneGeo = trackRel(new THREE.ConeGeometry(1.5, 3.2, 10));
    for (const e of edgesAll) {
      if (!evidenceSet.has(e.s) || !evidenceSet.has(e.t)) continue;
      const color = REL_COLOR[e.rt] ?? 0x6b6152;
      const mat = trackRel(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false }));
      _v1.set(positions[e.s * 3], positions[e.s * 3 + 1], positions[e.s * 3 + 2]);
      _v2.set(positions[e.t * 3], positions[e.t * 3 + 1], positions[e.t * 3 + 2]);
      _dir.subVectors(_v2, _v1);
      const len = Math.max(0.01, _dir.length()); _dir.normalize();
      const cyl = new THREE.Mesh(cylGeo, mat);
      cyl.position.lerpVectors(_v1, _v2, 0.5);
      cyl.quaternion.setFromUnitVectors(_Y, _dir);
      cyl.scale.set(1, len, 1);
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.position.copy(_v2).addScaledVector(_dir, -7.5);
      cone.quaternion.setFromUnitVectors(_Y, _dir);
      const { tex, aspect } = pillTex(e.rt, color);
      const pm = trackRel(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      const pill = new THREE.Sprite(pm);
      pill.position.lerpVectors(_v1, _v2, 0.5);
      const ph = 5.2; pill.scale.set(ph * aspect, ph, 1);
      pill.userData = { rel: e };
      rg.add(cyl, cone, pill);
      relPills.push(pill);
    }
    group.add(rg); relGroup = rg;
  };

  // ── 상호작용 ──
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(-2, -2);
  let hovered: number | null = null;
  let hoveredRel: Edge | null = null;
  let focusSet: (Set<number> & { primary?: number }) | null = null;
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    tip.style.left = e.clientX - r.left + 14 + "px";
    tip.style.top = e.clientY - r.top + 10 + "px";
  };
  // 클릭 판정은 rAF 루프의 hovered에 의존하지 않고 즉석 레이캐스트 —
  // pointermove 없는 탭(터치)·백그라운드 렌더 정지 상태에서도 정확히 동작
  const pickAt = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((clientY - r.top) / r.height) * 2 + 1;
    camera.updateMatrixWorld(true); // 렌더 프레임이 아직 없어도(백그라운드) 픽이 정확하도록
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(mouse, camera);
    const targets = relPills.length ? [...relPills, ...nodesArr] : nodesArr;
    const hit = raycaster.intersectObjects(targets, false)[0];
    const rel = (hit?.object.userData.rel as Edge | undefined) ?? null;
    return { rel, node: rel ? null : hit ? (hit.object.userData.i as number) : null };
  };
  const onClick = (e: MouseEvent) => {
    const { rel, node } = pickAt(e.clientX, e.clientY);
    if (node != null) {
      const fs: Set<number> & { primary?: number } = new Set([node, ...nbr[node]]);
      fs.primary = node;
      focusSet = fs;
      cbs().onInfo?.(`${G.nodes[node].id} · 연결 ${nbr[node].size}`);
      cbs().onSelectDoc?.(G.nodes[node].id);
    } else if (!rel) {
      focusSet = null;
      cbs().onInfo?.("");
      cbs().onSelectDoc?.(null);
    }
  };
  const onDblClick = (e: MouseEvent) => {
    const { node } = pickAt(e.clientX, e.clientY);
    if (node != null) cbs().onOpenDoc?.(G.nodes[node].id);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDblClick);

  // 근거 강조 시 카메라를 인용 묶음으로 부드럽게 이동
  const goalTarget = new THREE.Vector3(0, 0, 0);
  let goalDist: number | null = null;
  const camPos = new THREE.Vector3();
  const applyHighlights = (now: number) => {
    const pulse = 1 + Math.sin(now * 0.006) * 0.22;
    camera.getWorldPosition(camPos);
    for (const s of nodesArr) {
      const i = s.userData.i as number;
      const evid = evidenceSet?.has(i);
      let scale = s.userData.baseScale as number, op = 1;
      if (evid) scale = (s.userData.baseScale as number) * 1.8 * pulse;
      else if (focusSet) { if (focusSet.has(i)) scale *= i === focusSet.primary ? 1.55 : 1.2; else op = 0.1; }
      else if (evidenceSet) op = 0.4;
      if (hovered === i) scale *= 1.45;
      s.scale.setScalar(scale);
      const mat = (s as THREE.Mesh | THREE.Sprite).material as THREE.SpriteMaterial | THREE.MeshBasicMaterial;
      mat.opacity = op;
      if ((mat as THREE.SpriteMaterial).isSpriteMaterial) {
        const cat = G.nodes[i].cat;
        const want = evid ? discTex(EVID) : discTex(CAT_COLOR[cat] ?? 0x888888, EXTERNAL.has(cat));
        if (mat.map !== want) { mat.map = want; mat.needsUpdate = true; }
      } else if ((mat as THREE.MeshBasicMaterial).color) {
        (mat as THREE.MeshBasicMaterial).color.setHex(evid ? EVID : 0xffffff);
      }
    }
    const camDist = Math.max(120, camPos.distanceTo(controls.target));
    for (const l of labelsArr) {
      const i = l.userData.i as number;
      const evid = evidenceSet?.has(i);
      const d = camPos.distanceTo(l.position);
      const distFade = Math.max(0, Math.min(1, 1.95 - d / (camDist * 0.92)));
      let vis: number;
      if (evid) vis = 1;
      else if (focusSet) vis = focusSet.has(i) ? 1 : 0;
      else if (l.userData.ext) vis = hovered === i ? 1 : 0;
      else vis = Math.max(hovered === i ? 1 : 0, distFade * (evidenceSet ? 0.3 : 1));
      (l.material as THREE.SpriteMaterial).opacity = vis;
      l.visible = vis > 0.04;
      const boost = evid || hovered === i || (focusSet && focusSet.has(i)) ? 1.3 : 1;
      const lh = (l.userData.baseH as number) * boost;
      l.scale.set(lh * (l.userData.aspect as number), lh, 1);
    }
  };

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);
  renderer.setSize(container.clientWidth || 600, container.clientHeight || 420, false);
  camera.aspect = (container.clientWidth || 600) / (container.clientHeight || 420);
  camera.updateProjectionMatrix();

  let raf = 0;
  let disposed = false;
  const frame = (now: number) => {
    if (disposed) return;
    controls.update();
    // 근거 강조 카메라 유도 — 타깃·거리를 목표로 감쇠 이동
    controls.target.lerp(goalTarget, 0.06);
    if (goalDist != null) {
      const cur = camera.position.distanceTo(controls.target);
      const next = cur + (goalDist - cur) * 0.06;
      camera.position.sub(controls.target).setLength(next).add(controls.target);
      if (Math.abs(next - goalDist) < 1) goalDist = null;
    }
    raycaster.setFromCamera(mouse, camera);
    const targets = relPills.length ? [...relPills, ...nodesArr] : nodesArr;
    const hit = raycaster.intersectObjects(targets, false)[0];
    const rel = (hit?.object.userData.rel as Edge | undefined) ?? null;
    const nh = rel ? null : hit ? (hit.object.userData.i as number) : null;
    if (nh !== hovered || rel !== hoveredRel) {
      hovered = nh; hoveredRel = rel;
      canvas.style.cursor = nh != null || rel ? "pointer" : "grab";
      if (rel) {
        const c = "#" + (REL_COLOR[rel.rt] ?? 0x6b6152).toString(16).padStart(6, "0");
        tip.innerHTML =
          `<b style="color:#a56a08">${esc(G.nodes[rel.s].id)}</b> <span style="color:${c};font-weight:800">─${esc(rel.rt)}→</span> <b style="color:#a56a08">${esc(G.nodes[rel.t].id)}</b>` +
          (rel.reason ? `<br><span style="font-size:11px;color:#6b6152">${esc(rel.reason)}</span>` : "");
        tip.style.opacity = "1";
      } else if (nh != null) {
        tip.innerHTML = `<b style="color:#a56a08">${esc(G.nodes[nh].id)}</b> · ${esc(G.nodes[nh].cat)} · 연결 ${nbr[nh].size}`;
        tip.style.opacity = "1";
      } else tip.style.opacity = "0";
    }
    applyHighlights(now);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setEvidence(titles: string[]) {
      const idxs = titles.map((t) => idIdx.get(t)).filter((i): i is number => i != null);
      focusSet = null;
      if (idxs.length) {
        evidenceSet = new Set(idxs);
        buildRelOverlay();
        // 인용 묶음 중심·범위로 카메라 유도
        const c = new THREE.Vector3();
        idxs.forEach((i) => c.add(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])));
        c.multiplyScalar(1 / idxs.length);
        let spread = 0;
        idxs.forEach((i) => { spread = Math.max(spread, c.distanceTo(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))); });
        goalTarget.copy(c);
        goalDist = Math.min(380, Math.max(130, spread * 2.6 + 70));
        controls.autoRotate = false;
      } else {
        evidenceSet = null;
        clearRelOverlay();
        goalTarget.set(0, 0, 0);
        goalDist = null;
        controls.autoRotate = true;
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDblClick);
      clearRelOverlay();
      disposables.forEach((d) => { try { d.dispose(); } catch { /* noop */ } });
      renderer.dispose();
      container.removeChild(canvas);
      container.removeChild(tip);
    },
  };
}

export function KnowledgeGraph3D({ data, highlight, onInfo, onSelectDoc, onOpenDoc }: {
  data: GraphData3D; highlight?: string[]; onInfo?: (s: string) => void; onSelectDoc?: (title: string | null) => void; onOpenDoc?: (title: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const hlRef = useRef<string[]>([]);
  const cbsRef = useRef<SceneCbs>({});
  cbsRef.current = { onInfo, onSelectDoc, onOpenDoc };

  useEffect(() => {
    if (!boxRef.current || !data) return;
    const h = buildScene(boxRef.current, data, () => cbsRef.current);
    handleRef.current = h;
    h.setEvidence(hlRef.current);
    return () => { h.dispose(); handleRef.current = null; };
  }, [data]);

  useEffect(() => {
    hlRef.current = (highlight || []).filter(Boolean);
    handleRef.current?.setEvidence(hlRef.current);
  }, [highlight]);

  return <div ref={boxRef} className="relative h-full w-full overflow-hidden rounded-b-[var(--ax-radius-lg)]" />;
}
