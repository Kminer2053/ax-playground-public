/**
 * 사규 표 성격 분류기 — 청크(조문/별표/별지) 단위 4분류 + 신뢰도.
 *  A 기준표: 판단기준(전결·양정·배점·요율·한도…) → 행 명제화 대상
 *  B 서식표: 작성양식(별지 서식·신청서·점검표…) → 용도 주석 대상
 *  C 본문표: 조문형 본문 속 보조표·체계도·예시 → 현행 유지
 *  D 연혁·목록: 부칙 연혁·목차성 → 현행 유지
 * 규칙 기반(투명·폐쇄망 자급) — LLM 미사용. 검수시트로 사람 확정 가능.
 */
export type TableKind = "A" | "B" | "C" | "D";
export type TableClass = {
  kind: TableKind;
  conf: "상" | "중" | "하";
  scoreA: number;
  scoreB: number;
  scoreC: number;
  signals: string[]; // 판정 근거(검수시트 표기용)
  rows: number;      // 파이프 행 수
  emptyPct: number;  // 빈 셀 비율(%)
};

const RE = {
  // 이름 신호(강)
  nameA: /양정|전결|배점|요율|수수료|단가|한도|등급표|가점|감점|평가지표|부과기준|산정기준|지급기준|징계.?기준|처리기준|판단기준|심사기준|선정.?기준|평가.?기준|집행기준|체결기준/,
  nameAWeak: /별표.*기준|기준.*별표|기간표|정원표|요건|대상\s*(업무|목록|기관)|분장업무|연계현황/,
  nameB: /별지|서식|신청서|확인서|통지서|서약서|동의서|각서|위임장|명부|대장|조서|점검표|체크리스트|카드\)|표지|양식|기록부|기록지|일지|평정서|통보서/,
  nameC: /일반조건|특수조건|계약서|체계도|조직도|절차도|프로세스|예시|샘플|안내문|현황도|구성도|흐름도|용어\s*(의\s*)?정의/,
  nameD: /^부칙|연혁|목\s*차/,
  // 내용 신호
  critHead: /이상|이하|초과|미만|파면|해임|정직|감봉|견책|배점|점수|등급|요율|%|퍼센트|전결|승인권|기준/,
  // '소속·직급'류는 조직/매핑표에서 오탐이 많아 제외 — 서명·날인·신청인 등 강신호만
  formCell: /성\s*명|서\s*명|\(인\)|날인|\(서명\)|주민등록|연락처|년\s+월\s+일|귀하|신청인|작성자|위와 같이|기재하/,
  mark: /[●○◎✓√]/,
  money: /[0-9일이삼사오육칠팔구십백천만억]+\s*(원|만원|억원)/g,
  jomun: /제\s*\d+\s*조/g,
  blank3: /\|\s*\|\s*\|/,
};

export function classifyTableChunk(name: string, fullText: string): TableClass | null {
  const t = fullText ?? "";
  const lines = t.split("\n");
  const rows = lines.filter((l) => l.trimStart().startsWith("|"));
  if (rows.length < 3) return null; // 표 없음(분류 대상 아님)

  const cells = rows.flatMap((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
  const emptyPct = Math.round((cells.filter((c) => !c).length / Math.max(cells.length, 1)) * 100);
  const head3 = rows.slice(0, 3).join(" ");
  const jomunCount = (t.match(RE.jomun) || []).length;
  const moneyCount = (t.match(RE.money) || []).length;
  const sig: string[] = [];
  let A = 0, B = 0, C = 0;

  // ① 이름(가장 신뢰) — 서로 배타 가산
  if (RE.nameD.test(name)) return { kind: "D", conf: "상", scoreA: 0, scoreB: 0, scoreC: 0, signals: ["이름:부칙/연혁"], rows: rows.length, emptyPct };
  if (RE.nameA.test(name)) { A += 5; sig.push("이름:기준어"); }
  else if (RE.nameAWeak.test(name)) { A += 2; sig.push("이름:기준약"); }
  if (RE.nameB.test(name)) { B += 4; sig.push("이름:서식어"); }
  if (RE.nameC.test(name)) { C += 4; sig.push("이름:본문/도식어"); }

  // ② 본문형(조문 밀도) — 일반조건류: 표는 곁가지
  if (jomunCount >= 8 && rows.length < lines.length * 0.3) { C += 3; sig.push(`조문밀도(${jomunCount})`); }

  // ③ 내용 신호
  if (RE.critHead.test(head3)) { A += 2; sig.push("헤더:기준어"); }
  if (RE.mark.test(t)) { A += 2; sig.push("●○마크"); }
  if (moneyCount >= 3) { A += 1; sig.push(`금액표현×${moneyCount}`); }
  if (RE.formCell.test(rows.join(" "))) { B += 2; sig.push("서식셀(성명/서명/일자)"); }
  if (emptyPct >= 55) { B += 2; sig.push(`빈셀${emptyPct}%`); }
  else if (emptyPct >= 35) { B += 1; }
  else if (emptyPct <= 15) { A += 1; sig.push("충전율높음"); }

  // ④ 판정 + 신뢰도(1·2위 점수차)
  const ranked: [TableKind, number][] = [["A", A], ["B", B], ["C", C]];
  ranked.sort((x, y) => y[1] - x[1]);
  const [top, second] = ranked;
  const margin = top[1] - second[1];
  const kind: TableKind = top[1] === 0 ? "C" : top[0]; // 아무 신호 없으면 본문표 취급
  const conf: TableClass["conf"] = margin >= 4 ? "상" : margin >= 2 ? "중" : "하";
  return { kind, conf, scoreA: A, scoreB: B, scoreC: C, signals: sig, rows: rows.length, emptyPct };
}
