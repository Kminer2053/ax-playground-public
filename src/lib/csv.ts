/**
 * CSV 셀 직렬화 — 구분자 이스케이프 + 수식 인젝션(CSV Formula Injection, CWE-1236) 차단.
 *
 * 엑셀·스프레드시트는 =,+,-,@ (및 탭·캐리지리턴)로 시작하는 셀을 수식/명령으로 해석한다.
 * 익명 사용자 입력이 그대로 담기는 내보내기(감사로그·피드백 등)에서 =HYPERLINK(...) 같은 값이
 * 관리자 PC에서 실행될 수 있으므로, 위험 문자로 시작하면 앞에 작은따옴표를 붙여 무력화한다.
 * 단, -5·-3.14 같은 순수(음수) 숫자는 데이터 훼손을 막기 위해 예외로 둔다.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
