import { headers } from "next/headers";
import { env } from "@/lib/env";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

/** 요청 클라이언트 IP. SEC-002: X-Forwarded-For의 leftmost는 클라이언트가 위조할 수 있으므로
 *  신뢰 프록시가 '뒤에' 덧붙인 실 IP(뒤에서 hops번째)를 사용한다. ADMIN_TRUSTED_PROXY_HOPS=0이면
 *  XFF를 신뢰하지 않고(직접 노출 배포) IP를 반환하지 않는다 → IP 제한은 loopback만 유효. */
export async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    const hops = env.ADMIN_TRUSTED_PROXY_HOPS;
    if (hops <= 0) return ""; // XFF 미신뢰 배포
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[Math.max(0, parts.length - hops)];
    }
    return (h.get("x-real-ip") || "").trim();
  } catch {
    return "";
  }
}

function ipToInt(ip: string): number | null {
  const p = ip.trim().split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    const v = Number(o);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/** IP가 규칙(단일 IP 또는 IPv4 CIDR "a.b.c.d/n")에 매칭되는가. */
export function ipMatches(ip: string, rule: string): boolean {
  rule = rule.trim();
  if (!rule || !ip) return false;
  if (rule === ip) return true;
  const slash = rule.indexOf("/");
  if (slash < 0) return false;
  const base = ipToInt(rule.slice(0, slash));
  const target = ipToInt(ip);
  const bits = Number(rule.slice(slash + 1));
  if (base == null || target == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (base & mask) === (target & mask);
}

/** env ∪ DB(설정) 허용 IP 목록. env는 부트스트랩/복구용(항상 포함) — 잘못 등록으로 인한 자기잠금 방지. */
export async function adminAllowedList(): Promise<string[]> {
  const parse = (s?: string) => (s || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const fromEnv = parse(env.ADMIN_ALLOWED_IPS);
  let fromDb: string[] = [];
  try { fromDb = parse((await getPlaygroundConfig()).adminAllowedIps); } catch { /* DB 실패 시 env만 */ }
  return [...new Set([...fromEnv, ...fromDb])];
}

/** 로컬호스트(서비스가 구동되는 머신)인가 — 잠금 최종 복구경로로 항상 허용. */
function isLoopback(ip: string): boolean {
  return ip === "::1" || ip === "::ffff:127.0.0.1" || /^127\./.test(ip);
}

/**
 * 관리자 접속 IP 허용 여부.
 *  - **서비스 구동 머신(localhost/loopback)에서의 접근은 어떤 경우에도 허용** → 잘못 설정해도 박스에서 복구 가능.
 *  - 목록이 비어있으면 제한 없음(기본 off) → 기존 동작 유지.
 *  - IP를 탐지 못하면(프록시 XFF 미설정 등) 자기잠금 방지 위해 허용 + 경고.
 */
export async function isAdminIpAllowed(): Promise<boolean> {
  const ip = await getClientIp();
  if (isLoopback(ip)) return true; // 서비스 머신 자체 접근은 항상 통과(복구경로)
  const list = await adminAllowedList();
  if (!list.length) return true;
  if (!ip) {
    console.warn("[adminIp] 허용 IP가 설정됐으나 클라이언트 IP를 탐지하지 못함(리버스프록시 x-forwarded-for 확인) — 잠금방지로 허용 처리");
    return true;
  }
  return list.some((r) => ipMatches(ip, r));
}
