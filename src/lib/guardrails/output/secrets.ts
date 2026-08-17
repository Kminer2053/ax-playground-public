/**
 * GR3-2 (M13): 출력 민감정보 필터 (llm-guard Output Scanner 동급).
 * - 자격증명·비밀키·토큰·내부 IP는 마스킹([SECRET]/[IP]).
 * - 명백한 파괴적 명령(악성코드 패턴)은 차단 신호를 반환.
 */

import { env } from "@/lib/env";

export type SecretType = "PRIVATE_KEY" | "API_KEY" | "JWT" | "PASSWORD" | "INTERNAL_IP";

type SecretRule = {
  type: SecretType;
  regex: RegExp;
  placeholder: string;
};

// 내부망 사설 대역(10.x·172.16~31.x·192.168.x)은 보편값이라 유지(하드코딩). 운영 서버 고정 공인 IP 등
// 보호할 추가 IP는 소스에 박지 않고 (1) env MASK_EXTRA_IPS, (2) 관리자페이지 → DB(guard config
// maskExtraIps)로 주입한다(SEC-008). 마스킹 대상 = 사설대역 ∪ env ∪ DB.
const PRIVATE_IP_ALTS =
  "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}";
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const ENV_MASK_IPS = (env.MASK_EXTRA_IPS || "").split(",").map((s) => s.trim()).filter((s) => IP_LITERAL.test(s));

// 조합(env ∪ DB)별로 regex를 메모이즈 — 설정은 드물게 바뀌므로 대개 캐시 적중.
let _ipKey: string | null = null;
let _ipRegex: RegExp = new RegExp(`\\b(?:${PRIVATE_IP_ALTS})\\b`, "g");
function internalIpRegex(extra: string[]): RegExp {
  const extras = [...ENV_MASK_IPS, ...extra].filter((s) => IP_LITERAL.test(s));
  const key = extras.join(",");
  if (key !== _ipKey) {
    _ipKey = key;
    const alts = extras.length
      ? `${PRIVATE_IP_ALTS}|${extras.map((ip) => ip.replace(/\./g, "\\.")).join("|")}`
      : PRIVATE_IP_ALTS;
    _ipRegex = new RegExp(`\\b(?:${alts})\\b`, "g");
  }
  return _ipRegex;
}

const SECRET_RULES: SecretRule[] = [
  {
    type: "PRIVATE_KEY",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    placeholder: "[SECRET]",
  },
  {
    type: "JWT",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    placeholder: "[SECRET]",
  },
  {
    // OpenAI/Anthropic/AWS/GitHub 류 키 프리픽스 + 일반 32+ 시크릿
    type: "API_KEY",
    regex: /\b(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    placeholder: "[SECRET]",
  },
  {
    type: "PASSWORD",
    regex: /\b(?:password|passwd|pwd|비밀번호|패스워드)\s*[:=]\s*\S{4,}/gi,
    placeholder: "[SECRET]",
  },
  // INTERNAL_IP는 env·DB 설정에 따라 달라져 scanOutputSecrets에서 동적으로 처리한다(아래).
];

// 명백히 파괴적인 셸/코드 패턴 → 출력 차단.
const MALICIOUS_PATTERNS: { id: string; regex: RegExp }[] = [
  { id: "rm-rf-root", regex: /\brm\s+-rf\s+(?:--no-preserve-root\s+)?\/(?:\s|$|\*)/ },
  { id: "fork-bomb", regex: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/ },
  { id: "mkfs", regex: /\bmkfs\.\w+\s+\/dev\// },
  { id: "dd-disk", regex: /\bdd\s+if=\S+\s+of=\/dev\/(?:sd|nvme|hd)\w*/ },
];

export type SecretScanResult = {
  text: string;
  maskedTypes: SecretType[];
  malicious: string | null; // 차단 사유 rule id (없으면 null)
};

/** 출력 시크릿·내부 IP 마스킹 + 악성 패턴 차단.
 *  @param extraMaskIps 관리자 DB 설정(guard config maskExtraIps)에서 온 추가 마스킹 IP(env와 합쳐 적용). */
export function scanOutputSecrets(output: string, extraMaskIps: string[] = []): SecretScanResult {
  const malice = MALICIOUS_PATTERNS.find((p) => p.regex.test(output));
  let text = output;
  const maskedTypes: SecretType[] = [];

  for (const rule of SECRET_RULES) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(text)) {
      maskedTypes.push(rule.type);
      rule.regex.lastIndex = 0;
      text = text.replace(rule.regex, rule.placeholder);
    }
  }

  // 내부 IP(사설 ∪ env ∪ DB) 마스킹 — 설정 의존이라 별도 처리.
  const ipRe = internalIpRegex(extraMaskIps);
  ipRe.lastIndex = 0;
  if (ipRe.test(text)) {
    maskedTypes.push("INTERNAL_IP");
    ipRe.lastIndex = 0;
    text = text.replace(ipRe, "[IP]");
  }

  return {
    text,
    maskedTypes: [...new Set(maskedTypes)],
    malicious: malice?.id ?? null,
  };
}
