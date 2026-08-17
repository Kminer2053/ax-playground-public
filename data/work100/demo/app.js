/* 업무 무한성 v5 — 정육면체 복셀 + 분산 노드 포켓 + 직각(맨해튼) 통로망 + 90° 스냅 시선 + 통로 탐험 카메라 */
(function () {
  const T = window.THREE;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── 가짜 데이터 ──────────────────────────────────────────────
  const DEPTS = [
    { id: "hr",    name: "경영지원",   hue: 0xe0a04a, center: new T.Vector3(28, 20, 16) },
    { id: "fin",   name: "재무·계약",  hue: 0xd97a4a, center: new T.Vector3(-30, -14, 22) },
    { id: "biz",   name: "영업·전문점", hue: 0xcdb04e, center: new T.Vector3(18, 6, -30) },
    { id: "ad",    name: "광고·홍보",  hue: 0xa78ae0, center: new T.Vector3(-22, 28, -16) },
    { id: "safe",  name: "안전·시설",  hue: 0x4ec2a8, center: new T.Vector3(24, -26, -10) },
    { id: "audit", name: "감사·정보",  hue: 0x7aa3d9, center: new T.Vector3(-14, 10, 30) },
  ];
  const TASKS = [
    { d: "hr", n: "채용·임용 관리", desc: "채용 공고부터 임용 발령까지의 인사 절차", regs: ["인사 규정", "인사규정 시행세칙", "채용 시행세칙"], steps: ["채용 계획 수립", "공고·전형", "임용 발령"] },
    { d: "hr", n: "연차휴가 관리", desc: "연차 발생·사용·이월과 미사용 보상", regs: ["취업 규칙", "급여 규정"], steps: ["발생일수 산정", "사용 신청·승인", "미사용 정산"] },
    { d: "hr", n: "징계·상벌 처리", desc: "비위 조사부터 징계위원회 의결까지", regs: ["상벌운영 세칙", "인사 규정"], steps: ["비위 조사", "징계위 회부", "의결·통보"] },
    { d: "hr", n: "성과평가 운영", desc: "조직·개인 성과평가와 등급 배분", regs: ["내부성과평가 편람", "인사 규정"], steps: ["평가계획 수립", "실적 평가", "등급 확정"] },
    { d: "hr", n: "급여·수당 지급", desc: "월 급여·수당·퇴직급여 산정과 지급", regs: ["급여 규정", "급여규정 시행세칙"], steps: ["근태 마감", "산정·검증", "지급"] },
    { d: "fin", n: "수의계약 체결", desc: "소액·특정 사유 수의계약의 성립 절차", regs: ["계약업무 처리지침", "위임전결 규정"], steps: ["사유 검토", "견적 접수", "전결·체결"] },
    { d: "fin", n: "입찰·계약 심의", desc: "일반경쟁 입찰과 계약심의회 운영", regs: ["계약업무 처리지침"], steps: ["공고", "개찰·평가", "심의·낙찰"] },
    { d: "fin", n: "예산 편성·배정", desc: "연간 예산 편성과 부서별 배정", regs: ["예산관리 규정", "위임전결 규정"], steps: ["편성 지침", "부서 요구", "확정·배정"] },
    { d: "fin", n: "자산 취득·처분", desc: "자산의 취득·이관·불용 처분 관리", regs: ["자산관리 규정", "위임전결 규정"], steps: ["취득 품의", "등재·관리", "처분 의결"] },
    { d: "fin", n: "법인카드·경비 처리", desc: "법인카드 사용과 경비 정산 통제", regs: ["회계 규정", "위임전결 규정"], steps: ["사용 신청", "증빙 정산", "월 마감"] },
    { d: "biz", n: "전문점 운영 계약", desc: "전문점 입점·운영 계약의 체결과 갱신", regs: ["전문점 운영 계약서", "전문점 운영 편람"], steps: ["입점 심사", "계약 체결", "운영 개시"] },
    { d: "biz", n: "매장 개점·폐점", desc: "역사 매장의 개점 준비와 폐점 정산", regs: ["영업 규정", "철도구내영업 규정"], steps: ["입지 검토", "개점 승인", "정산·인계"] },
    { d: "biz", n: "임대료·수수료 정산", desc: "매장 임대료·판매수수료의 산정과 청구", regs: ["영업 규정", "전문점 운영 계약서"], steps: ["매출 집계", "요율 적용", "청구·수납"] },
    { d: "biz", n: "상품 구성 승인", desc: "판매 상품의 구성·변경 승인", regs: ["영업 규정", "위임전결 규정"], steps: ["구성안 접수", "적합성 검토", "승인"] },
    { d: "biz", n: "매출 마감·검수", desc: "일·월 매출 마감과 검수 처리", regs: ["회계 규정", "영업 규정"], steps: ["일마감", "검수 대사", "월 확정"] },
    { d: "ad", n: "철도광고 도안 심의", desc: "광고 도안의 문구·시각 심의", regs: ["철도광고 규정", "광고심의 기준"], steps: ["도안 접수", "심의", "게첨 승인"] },
    { d: "ad", n: "광고 계약 관리", desc: "광고 매체 계약의 체결과 이행 관리", regs: ["철도광고 규정", "계약업무 처리지침"], steps: ["매체 협의", "계약 체결", "게첨·정산"] },
    { d: "ad", n: "홍보물 제작·배포", desc: "대내외 홍보물 제작과 배포 승인", regs: ["홍보업무 지침"], steps: ["기획", "제작", "배포"] },
    { d: "ad", n: "브랜드 사용 승인", desc: "CI·BI 사용 신청과 승인 관리", regs: ["홍보업무 지침", "사규관리 규정"], steps: ["사용 신청", "적합성 검토", "승인"] },
    { d: "ad", n: "옥외광고 신고", desc: "옥외광고물 설치 신고와 관리", regs: ["철도광고 규정"], steps: ["설치 계획", "신고", "사후 점검"] },
    { d: "safe", n: "매장 안전점검", desc: "정기·수시 매장 안전점검과 조치", regs: ["안전관리 표준매뉴얼"], steps: ["점검 계획", "현장 점검", "시정 조치"] },
    { d: "safe", n: "소방·방염 관리", desc: "소방시설과 방염성능 기준 관리", regs: ["안전관리 표준매뉴얼", "시설관리 편람"], steps: ["기준 확인", "점검", "보수"] },
    { d: "safe", n: "시설물 유지보수", desc: "매장·설비 유지보수 요청 처리", regs: ["시설관리 편람", "위임전결 규정"], steps: ["요청 접수", "견적·전결", "시공 검수"] },
    { d: "safe", n: "중대재해 대응", desc: "중대재해 예방 점검과 발생 시 대응", regs: ["중대재해 대응 매뉴얼", "안전관리 표준매뉴얼"], steps: ["위험성 평가", "예방 조치", "사고 대응"] },
    { d: "safe", n: "위생·식품안전 점검", desc: "식품 취급 매장의 위생 점검", regs: ["위생관리 지침"], steps: ["점검 계획", "현장 점검", "개선 확인"] },
    { d: "audit", n: "종합감사 수행", desc: "연간 계획에 따른 종합감사", regs: ["감사 규정", "감사규정 시행세칙"], steps: ["계획 수립", "실지 감사", "결과 처분"] },
    { d: "audit", n: "일상감사 처리", desc: "주요 결재 전 일상감사 협의", regs: ["감사 규정", "위임전결 규정"], steps: ["대상 접수", "검토 의견", "통보"] },
    { d: "audit", n: "기록물 관리", desc: "기록물의 등록·보존·폐기", regs: ["기록관운영 세칙"], steps: ["등록", "보존", "평가·폐기"] },
    { d: "audit", n: "개인정보보호 운영", desc: "개인정보 처리방침과 접근 통제", regs: ["개인정보보호 지침"], steps: ["처리방침 관리", "접근 통제", "점검"] },
    { d: "audit", n: "사규 제·개정 관리", desc: "사규 제·개정 절차와 해석 관리", regs: ["사규관리 규정"], steps: ["입안", "심의", "공포·게시"] },
  ];
  const CROSS = [[5,6],[5,26],[10,12],[15,16],[20,23],[0,4],[2,25],[3,2],[11,22],[27,28],[29,1],[7,14],[18,17],[24,20],[9,25],[16,6]];
  // 통로망(하나로 연결): 부서 순환 루프 + 협업 지름길 — 이 '빈 통로'가 곧 노드 연결선
  const LOOP = ["hr", "fin", "biz", "ad", "safe", "audit", "hr"];
  const SHORTCUTS = [["fin", "audit"], ["biz", "safe"]];

  // ── 렌더러·씬 ────────────────────────────────────────────────
  const canvas = document.getElementById("gl");
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new T.Scene();
  scene.background = new T.Color(0x0a0705);
  scene.fog = new T.Fog(0x0a0705, 40, 120);
  const camera = new T.PerspectiveCamera(58, 1, 0.1, 600);
  scene.add(new T.AmbientLight(0x3a2c1c, 1.5));
  const warm1 = new T.PointLight(0xffb45e, 3200, 0, 2); warm1.position.set(10, 20, 12); scene.add(warm1);
  const warm2 = new T.PointLight(0xff9a3c, 1600, 0, 2); warm2.position.set(-16, -14, -10); scene.add(warm2);
  const rim = new T.DirectionalLight(0x5a4630, 1.0); rim.position.set(80, 120, 60); scene.add(rim); // 원경에서 큐브 외벽 인지용

  const box = new T.BoxGeometry(1, 1, 1);
  const rng = (a, b) => a + Math.random() * (b - a);

  // ── 다다미방 창호 텍스처 ─────────────────────────────────────
  function makeRoomTexture() {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#120d07"; g.fillRect(0, 0, 128, 128);
    for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) {
      const x = 10 + ix * 58, y = 14 + iy * 54, w = 50, h = 42;
      const lit = Math.random() < 0.55;
      if (lit) {
        g.fillStyle = ["#f6b45e", "#eda04b", "#ffc97e", "#d98736"][(Math.random() * 4) | 0];
        g.fillRect(x, y, w, h);
        g.strokeStyle = "#4a3012"; g.lineWidth = 3;
        g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
        g.beginPath();
        g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h);
        g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2);
        g.stroke();
      } else {
        g.fillStyle = Math.random() < 0.5 ? "#221709" : "#191108"; g.fillRect(x, y, w, h);
        g.strokeStyle = "#0d0905"; g.lineWidth = 2; g.strokeRect(x, y, w, h);
      }
    }
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t;
  }
  const roomTexes = [0, 1, 2, 3, 4, 5].map(makeRoomTexture);

  // ── 정육면체 복셀 + 포켓·직각 통로 파내기 ────────────────────
  // 월드 한 변 ≈ 126 (다다미 셀: 5.4 × 4.2 × 5.4 → 나비×높이 비율 유지, 개수로 정육면체 맞춤)
  const CX = 5.4, CY = 4.2, CZ = 5.4, NX = 23, NY = 30, NZ = 23;
  const HALF = Math.max(NX * CX, NY * CY, NZ * CZ) / 2; // ≈ 63
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const cavities = [];
  DEPTS.forEach((d) => cavities.push({ t: "ell", c: d.center, r: V(14, 11.5, 14) })); // 노드 포켓(방)
  // 직각(맨해튼) 통로: A→B를 x→y→z 순 꺾임으로 연결. 통로 자체가 '연결선'이다.
  const corridorLegs = []; // 탐험 카메라용 폴리라인
  function addCorridor(A, B, r) {
    const p1 = V(B.x, A.y, A.z), p2 = V(B.x, B.y, A.z);
    const pts = [A, p1, p2, B];
    for (let i = 0; i < 3; i++) {
      if (pts[i].distanceTo(pts[i + 1]) < 0.5) continue;
      cavities.push({ t: "seg", a: pts[i], b: pts[i + 1], r });
      corridorLegs.push({ a: pts[i].clone(), b: pts[i + 1].clone() });
    }
  }
  for (let i = 0; i < LOOP.length - 1; i++) {
    const A = DEPTS.find((d) => d.id === LOOP[i]).center, B = DEPTS.find((d) => d.id === LOOP[i + 1]).center;
    addCorridor(A, B, 4.4);
  }
  SHORTCUTS.forEach(([a, b]) => addCorridor(DEPTS.find((d) => d.id === a).center, DEPTS.find((d) => d.id === b).center, 4.0));
  cavities.push({ t: "ell", c: V(0, 0, 0), r: V(34, 26, 34) }); // 중앙 대공동(v4식) — 포켓들과 이어져 넓은 내부 빈공간, 탐색성↑
  const _sv = new T.Vector3(), _sw = new T.Vector3();
  function inCavity(p) {
    for (const c of cavities) {
      if (c.t === "ell") {
        const dx = (p.x - c.c.x) / c.r.x, dy = (p.y - c.c.y) / c.r.y, dz = (p.z - c.c.z) / c.r.z;
        if (dx * dx + dy * dy + dz * dz < 1) return true;
      } else {
        _sv.subVectors(c.b, c.a); _sw.subVectors(p, c.a);
        const h = Math.max(0, Math.min(1, _sw.dot(_sv) / _sv.lengthSq()));
        if (_sw.addScaledVector(_sv, -h).length() < c.r) return true;
      }
    }
    return false;
  }
  const roomInstances = [];
  const p = new T.Vector3();
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
    p.set((i - NX / 2 + 0.5) * CX, (j - NY / 2 + 0.5) * CY, (k - NZ / 2 + 0.5) * CZ);
    if (inCavity(p)) continue;
    if (Math.random() < 0.05) continue; // 빽빽하게(랜덤 공실 5%)
    roomInstances.push({ x: p.x, y: p.y, z: p.z,
      sx: CX * rng(0.92, 1.03), sy: CY * rng(0.9, 1.03), sz: CZ * rng(0.92, 1.03),
      warm: 0.45 + Math.random() * 0.62 });
  }
  const m4 = new T.Matrix4(), q0 = new T.Quaternion(), sc = new T.Vector3(), col = new T.Color();
  const perTex = Math.ceil(roomInstances.length / roomTexes.length);
  roomTexes.forEach((tex, ti) => {
    const chunk = roomInstances.slice(ti * perTex, (ti + 1) * perTex);
    if (!chunk.length) return;
    const im = new T.InstancedMesh(box, new T.MeshBasicMaterial({ map: tex, fog: true }), chunk.length);
    chunk.forEach((r, kk) => {
      sc.set(r.sx, r.sy, r.sz);
      m4.compose(_sv.set(r.x, r.y, r.z), q0, sc);
      im.setMatrixAt(kk, m4);
      im.setColorAt(kk, col.setRGB(r.warm, r.warm * 0.93, r.warm * 0.82));
    });
    scene.add(im);
  });

  // ── 업무 노드(포켓 안, 축 정렬) ─────────────────────────────
  const cubes = [];
  const OFF = [[-3.1, 2.1, 0], [3.1, 1.0, -1.7], [-1.2, -2.2, 2.7], [2.1, -0.9, 2.4], [0.2, 2.9, -2.9]];
  DEPTS.forEach((dept) => {
    const tasks = TASKS.map((t, i) => ({ t, i })).filter((x) => x.t.d === dept.id);
    tasks.forEach(({ t, i }, k) => {
      const s = rng(2.3, 2.9);
      const mat = new T.MeshStandardMaterial({ color: dept.hue, roughness: 0.45, metalness: 0.08,
        emissive: dept.hue, emissiveIntensity: 0.4 }); // 완전 솔리드 컬러 큐브 — 부서색으로 즉각 구분
      const mesh = new T.Mesh(box, mat);
      const o = OFF[k % OFF.length];
      mesh.position.set(dept.center.x + o[0], dept.center.y + o[1], dept.center.z + o[2]);
      mesh.scale.setScalar(s);
      const edge = new T.LineSegments(new T.EdgesGeometry(box), new T.LineBasicMaterial({ color: new T.Color(dept.hue).lerp(new T.Color(0xffffff), 0.35), transparent: true, opacity: 0.9 }));
      mesh.add(edge);
      mesh.userData.idx = i;
      scene.add(mesh);
      cubes[i] = { mesh, edge, task: t, dept, baseScale: s };
    });
  });

  // ── 노드 연결 보조선(통로 속 빛줄기 — 주 연결 표현은 '빈 통로' 자체) ──
  function makeLines(pairs, color, opacity) {
    const pos = [];
    pairs.forEach(([a, b]) => { const A = cubes[a].mesh.position, B = cubes[b].mesh.position; pos.push(A.x, A.y, A.z, B.x, B.y, B.z); });
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    const l = new T.LineSegments(g, new T.LineBasicMaterial({ color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false }));
    scene.add(l); return l;
  }
  const intraPairs = [];
  DEPTS.forEach((dept) => {
    const idx = TASKS.map((t, i) => ({ t, i })).filter((x) => x.t.d === dept.id).map((x) => x.i);
    for (let k = 0; k < idx.length - 1; k++) intraPairs.push([idx[k], idx[k + 1]]);
  });
  const intraLines = makeLines(intraPairs, 0xffd08a, 0.3);
  const crossLines = makeLines(CROSS, 0x7fe0cc, 0.22);

  // ── 90° 스냅 시선 카메라 + 원경 줌 + 통로 탐험 ──────────────
  const goalQ = new T.Quaternion(); // 항상 축 정렬(90° 단위)
  const curQ = goalQ.clone();
  let goalR = 205, curR = 245; // 시작은 원경 — 무한성 큐브 전체를 밖에서 보고 진입
  const R_MIN = 6, R_MAX = 240; // 최대 줌아웃 = 큐브 전체 원경(진입 연출)
  const goalTarget = new T.Vector3(0, 0, 0), curTarget = new T.Vector3(0, 0, 0);
  const LX = new T.Vector3(1, 0, 0), LY = new T.Vector3(0, 1, 0);
  const dq = new T.Quaternion();
  const raycaster = new T.Raycaster(); const mouse = new T.Vector2(-2, -2); const tipXY = { x: 0, y: 0 };
  let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInteract = 0, accX = 0, accY = 0;
  const TURN = Math.PI / 2, TURN_PX = 64; // 드래그 64px마다 90° 한 칸
  function userAct() { lastInteract = performance.now(); stopTour(); }
  canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; accX = 0; accY = 0; lastX = e.clientX; lastY = e.clientY; userAct(); });
  addEventListener("pointermove", (e) => {
    mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    tipXY.x = e.clientX; tipXY.y = e.clientY;
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy); accX += dx; accY += dy;
    while (accX <= -TURN_PX) { goalQ.multiply(dq.setFromAxisAngle(LY, -TURN)); accX += TURN_PX; } // 좌로 끌면 우측을 본다
    while (accX >= TURN_PX)  { goalQ.multiply(dq.setFromAxisAngle(LY, TURN));  accX -= TURN_PX; }
    while (accY <= -TURN_PX) { goalQ.multiply(dq.setFromAxisAngle(LX, -TURN)); accY += TURN_PX; }
    while (accY >= TURN_PX)  { goalQ.multiply(dq.setFromAxisAngle(LX, TURN));  accY -= TURN_PX; }
    userAct();
  });
  addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); goalR = Math.min(R_MAX, Math.max(R_MIN, goalR * (1 + Math.sign(e.deltaY) * 0.1))); userAct(); }, { passive: false });

  // 탐험(대기) 모드 — 통로 폴리라인을 따라 노드 사이를 순항
  let tour = null; // {leg, t}
  const legLen = corridorLegs.map((l) => l.a.distanceTo(l.b));
  function startTour() {
    if (reduced || selected != null || goalR > 70) return;
    tour = { leg: Math.floor(Math.random() * corridorLegs.length), t: 0 };
  }
  function stopTour() { tour = null; }
  const dirV = new T.Vector3(), lookM = new T.Matrix4(), upV = new T.Vector3();
  function tourStep(dt) {
    const leg = corridorLegs[tour.leg];
    tour.t += (dt * 6) / Math.max(1, legLen[tour.leg]);
    if (tour.t >= 1) { tour.leg = (tour.leg + 1) % corridorLegs.length; tour.t = 0; return; }
    goalTarget.lerpVectors(leg.a, leg.b, tour.t);
    dirV.subVectors(leg.b, leg.a).normalize();
    upV.set(0, 1, 0); if (Math.abs(dirV.y) > 0.9) upV.set(0, 0, dirV.y > 0 ? 1 : -1); // 수직 통로에선 up 교체
    lookM.lookAt(new T.Vector3(0, 0, 0), dirV, upV);
    goalQ.setFromRotationMatrix(lookM); // 진행 방향을 바라본다(축 정렬 방향이므로 90° 규칙 유지)
    goalR = 2.6; // 통로 반경(4.0~4.4) 안에 머무는 추적 거리
  }

  // ── 상호작용(호버·선택) ─────────────────────────────────────
  const tip = document.getElementById("tip");
  let hovered = null, selected = null;
  canvas.addEventListener("click", (e) => {
    if (moved > 6) return;
    const mx = (e.clientX / innerWidth) * 2 - 1, my = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: mx, y: my }, camera);
    const h = raycaster.intersectObjects(cubes.map((c) => c.mesh), false)[0];
    if (h) select(h.object.userData.idx); else deselect();
  });
  // ── 업무 보드 모달(시범: 수의계약 체결) ──
  const bmodal = document.getElementById("bmodal");
  const motionSrc = document.getElementById("bsvgMotion").innerHTML;
  let bz = 1250; // 보드 표시 폭(px) — 원본 1800의 ~70%, 글자 가독 우선
  function applyZoom() {
    document.querySelectorAll("#bleft svg").forEach((s) => { s.style.width = bz + "px"; s.style.maxWidth = "none"; });
  }
  document.getElementById("bzIn").onclick = () => { bz = Math.min(1800, bz + 150); applyZoom(); };
  document.getElementById("bzOut").onclick = () => { bz = Math.max(600, bz - 150); applyZoom(); };
  document.getElementById("bzFit").onclick = () => { bz = document.getElementById("bleft").clientWidth - 2; applyZoom(); };
  const bboard = document.getElementById("bboard");
  function openOntology() {
    const P = window.PILOT;
    document.getElementById("bName").textContent = P.name;
    document.getElementById("bDesc").textContent = P.desc;
    document.getElementById("bOwn").textContent = P.own;
    document.getElementById("bAppr").textContent = P.appr;
    document.getElementById("bRefs").innerHTML = P.refs.map((r) =>
      `<div class="bref"><span class="basis">${r.basis}</span>${r.cat ? `<span class="ext">${r.cat} · 원문 수록</span>` : ""}<span>${r.label}</span></div>`).join("");
    bmodal.classList.add("show");
  }
  // 상세 업무흐름: 온톨로지 패널 → 전체화면 보드, 접기 → 다시 패널로
  document.getElementById("bDetail").onclick = () => {
    bmodal.classList.remove("show");
    document.getElementById("bsvgStatic").style.display = "";
    document.getElementById("bsvgMotion").style.display = "none";
    bboard.classList.add("show");
    applyZoom();
  };
  document.getElementById("bFold").onclick = () => { bboard.classList.remove("show"); bmodal.classList.add("show"); };
  document.getElementById("bclose").onclick = () => bmodal.classList.remove("show");
  bmodal.addEventListener("click", (e) => { if (e.target === bmodal) bmodal.classList.remove("show"); });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (bboard.classList.contains("show")) { bboard.classList.remove("show"); bmodal.classList.add("show"); }
    else bmodal.classList.remove("show");
  });
  document.getElementById("bmotion").onclick = () => {
    const m = document.getElementById("bsvgMotion");
    m.innerHTML = motionSrc; // 재주입 + 타임라인 0으로 — SMIL 처음부터 재생(1회 후 유지, freeze 패치본)
    document.getElementById("bsvgStatic").style.display = "none";
    m.style.display = "";
    applyZoom();
    const ms = m.querySelector("svg");
    if (ms && ms.setCurrentTime) ms.setCurrentTime(0);
  };
  document.getElementById("bLaw").onclick = () => toast("데모 — 실서비스에서는 근거 조문 뷰(외부규범 포함)가 열립니다");
  document.getElementById("bAsk").onclick = () => toast("데모 — 실서비스에서는 지식검색에 질문이 프리필됩니다");

  function select(i) {
    userAct();
    selected = i;
    const c = cubes[i];
    goalTarget.copy(c.mesh.position); goalR = 10; // 포켓 공동(반경 14) 안에 머무는 거리
    if (window.PILOT && i === window.PILOT.taskIdx) { openOntology(); applyStyles(); return; }
    const t = c.task, d = c.dept;
    const hex = "#" + d.hue.toString(16).padStart(6, "0");
    document.getElementById("cardDept").textContent = d.name;
    document.getElementById("cardDept").style.background = hex + "33";
    document.getElementById("cardDept").style.color = hex;
    document.getElementById("cardName").textContent = t.n;
    document.getElementById("cardDesc").textContent = t.desc;
    document.getElementById("cardSteps").innerHTML = t.steps.map((s) => `<li>${s}</li>`).join("");
    document.getElementById("cardRegs").innerHTML = t.regs.map((r) => `<button class="chip" data-reg="${r}">「${r}」</button>`).join("");
    document.getElementById("card").classList.add("show");
    applyStyles();
  }
  function deselect() { selected = null; document.getElementById("card").classList.remove("show"); goalR = Math.max(goalR, 10); applyStyles(); }
  document.getElementById("cardClose").onclick = deselect;
  document.getElementById("card").addEventListener("click", (e) => {
    const reg = e.target?.dataset?.reg;
    if (reg) toast(`데모 — 실서비스에서는 「${reg}」 조문 직행으로 연결됩니다`);
    if (e.target.id === "btnAsk") toast("데모 — 실서비스에서는 지식검색에 질문이 프리필됩니다");
    if (e.target.id === "btnLaw") toast("데모 — 실서비스에서는 근거 조문 뷰가 열립니다");
  });

  // ── 필터·검색·뷰 전환 ───────────────────────────────────────
  let activeDept = null, query = "";
  const chipsEl = document.getElementById("chips");
  chipsEl.innerHTML = `<button class="fchip on" data-d="">전체</button>` + DEPTS.map((d) => `<button class="fchip" data-d="${d.id}" style="--h:#${d.hue.toString(16).padStart(6, "0")}">${d.name}</button>`).join("");
  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".fchip"); if (!b) return;
    activeDept = b.dataset.d || null;
    chipsEl.querySelectorAll(".fchip").forEach((x) => x.classList.toggle("on", x === b));
    userAct();
    if (activeDept) { const d = DEPTS.find((x) => x.id === activeDept); goalTarget.copy(d.center); goalR = 12; }
    else { goalTarget.set(0, 0, 0); goalR = 175; }
    applyStyles();
  });
  document.getElementById("q").addEventListener("input", (e) => { query = e.target.value.trim(); applyStyles(); });
  document.getElementById("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const m = matchedIdx(); if (m.length === 1) select(m[0]); }
    if (e.key === "Escape") { e.target.value = ""; query = ""; applyStyles(); }
  });
  function matchedIdx() {
    if (!query) return [];
    return TASKS.map((t, i) => ({ t, i })).filter(({ t }) => t.n.includes(query) || t.regs.some((r) => r.includes(query))).map((x) => x.i);
  }
  function applyStyles() {
    const matches = new Set(matchedIdx());
    cubes.forEach((c, i) => {
      let on = true;
      if (activeDept && c.task.d !== activeDept) on = false;
      if (query && !matches.has(i)) on = false;
      const sel = selected === i;
      c.mesh.material.emissiveIntensity = sel ? 1.1 : on ? (query || activeDept ? 0.75 : 0.4) : 0.04;
      c.mesh.material.color.setHex(on || sel ? c.dept.hue : 0x2a241c); // 필터 밖은 무채색으로 가라앉힘
      c.edge.material.opacity = sel ? 1 : on ? 0.9 : 0.12;
    });
    const dimLinks = !!(activeDept || query);
    intraLines.material.opacity = dimLinks ? 0.08 : 0.3;
    crossLines.material.opacity = dimLinks ? 0.06 : 0.22;
  }
  const kwPanel = document.getElementById("kwPanel");
  kwPanel.querySelector("#kwList").innerHTML = TASKS.map((t, i) => {
    const d = DEPTS.find((x) => x.id === t.d);
    return `<button class="kwRow" data-i="${i}"><b>${t.n}</b><span class="kwDept" style="color:#${d.hue.toString(16).padStart(6, "0")}">${d.name}</span><span class="kwRegs">${t.regs.map((r) => `「${r}」`).join(" ")}</span></button>`;
  }).join("");
  kwPanel.addEventListener("click", (e) => {
    const row = e.target.closest(".kwRow");
    if (row) { setView("gal"); select(+row.dataset.i); }
  });
  document.getElementById("seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (b) setView(b.dataset.v);
  });
  function setView(v) {
    document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    kwPanel.classList.toggle("show", v === "kw");
  }

  // ── 토스트·라벨·범례 ────────────────────────────────────────
  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  document.getElementById("legend").innerHTML = DEPTS.map((d) => `<span>● <b style="color:#${d.hue.toString(16).padStart(6, "0")}">${d.name}</b></span>`).join("");
  const labelsEl = document.getElementById("labels");
  labelsEl.innerHTML = DEPTS.map((d, i) => `<div class="clabel" id="cl${i}" style="color:#${d.hue.toString(16).padStart(6, "0")}">${d.name}<small>업무 ${TASKS.filter((t) => t.d === d.id).length}</small></div>`).join("");

  // ── 루프 ────────────────────────────────────────────────────
  const proj = new T.Vector3(), camOff = new T.Vector3();
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize); resize();

  let tPrev = performance.now();
  function frame(now) {
    const dt = Math.min(0.12, (now - tPrev) / 1000); tPrev = now;
    if (!tour && !reduced && !dragging && now - lastInteract > 20000 && selected == null && goalR <= 70) startTour();
    if (tour) tourStep(dt);

    // 프레임률 무관 시간 기반 감쇠(저사양에서도 이동 속도 동일)
    const kQ = 1 - Math.exp(-dt * (tour ? 3.0 : 5.0));
    const kR = 1 - Math.exp(-dt * (tour ? 3.2 : 4.2));
    const kT = 1 - Math.exp(-dt * (tour ? 3.6 : 4.2));
    curQ.slerp(goalQ, kQ); // 90° 전환·통로 코너를 부드럽게
    curR += (goalR - curR) * kR;
    curTarget.lerp(goalTarget, kT);
    camOff.set(0, 0, curR).applyQuaternion(curQ);
    camera.position.copy(curTarget).add(camOff);
    camera.quaternion.copy(curQ);

    // 원경 진입 연출: 줌 거리에 따라 안개를 열고 닫는다(밖=전경, 안=아늑한 심도)
    scene.fog.near = 24 + curR * 0.5;
    scene.fog.far = Math.max(120, curR * 2.4);

    // 호버 판정
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(cubes.map((c) => c.mesh), false)[0];
    const nh = hit ? hit.object : null;
    if (nh !== hovered) {
      hovered = nh;
      canvas.style.cursor = nh ? "pointer" : "grab";
      if (nh) {
        const c = cubes[nh.userData.idx];
        tip.innerHTML = `<b>${c.task.n}</b> · ${c.dept.name}`;
        tip.classList.add("show");
      } else tip.classList.remove("show");
      applyStyles();
      if (hovered && selected !== hovered.userData.idx) cubes[hovered.userData.idx].mesh.material.emissiveIntensity = 1.1;
    }
    if (tip.classList.contains("show")) { tip.style.left = tipXY.x + 14 + "px"; tip.style.top = tipXY.y + 12 + "px"; }

    // 선택 펄스
    cubes.forEach((c, i) => {
      const pl = (!reduced && selected === i) ? 1 + Math.sin(now * 0.004) * 0.035 : 1;
      c.mesh.scale.setScalar(c.baseScale * pl);
    });

    // 부서 라벨 투영
    DEPTS.forEach((d, i) => {
      proj.copy(d.center); proj.y += 7; proj.project(camera);
      const el = document.getElementById("cl" + i);
      const vis = proj.z < 1;
      el.style.display = vis ? "block" : "none";
      if (vis) { el.style.left = (proj.x * 0.5 + 0.5) * innerWidth + "px"; el.style.top = (-proj.y * 0.5 + 0.5) * innerHeight + "px"; }
    });

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  applyStyles();
  // 검증용 훅(데모 동작에 영향 없음)
  window.__dbg = () => ({ r: +curR.toFixed(1), goalR: +goalR.toFixed(1), target: curTarget.toArray().map((v) => +v.toFixed(1)), tour: !!tour, sel: selected, dept: activeDept });
  window.__select = select; window.__deselect = deselect;
})();
