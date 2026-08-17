/**
 * 랜덤 별명 생성 — 퀴즈 랭킹 등록 시 닉네임 미입력 대비.
 * 형용사 + 동물 + 3자리 숫자. (서버/클라 공용, CSPRNG)
 */
import { secureRandomInt } from "@/lib/random";

const ADJ = [
  "빠른", "현명한", "용감한", "호기심많은", "반짝이는", "느긋한", "엉뚱한", "날카로운",
  "따뜻한", "신중한", "유쾌한", "성실한", "재치있는", "대담한", "꼼꼼한", "비범한",
  "창의적인", "똑똑한", "부지런한", "침착한", "열정적인", "겸손한", "기발한", "센스있는",
];
const NOUN = [
  "판다", "수달", "여우", "부엉이", "고래", "치타", "펭귄", "다람쥐", "너구리", "돌고래",
  "사자", "호랑이", "코알라", "햄스터", "두루미", "거북이", "고슴도치", "알파카", "수리",
  "라쿤", "비버", "미어캣", "왈라비", "카피바라",
];

export function randomNickname(): string {
  const a = ADJ[secureRandomInt(ADJ.length)];
  const n = NOUN[secureRandomInt(NOUN.length)];
  const num = 100 + secureRandomInt(900);
  return `${a} ${n}${num}`;
}

/** 입력 닉네임 정제(공백/길이). 비면 랜덤 별명. */
export function normalizeNickname(input: unknown): string {
  if (typeof input === "string") {
    const t = input.trim().replace(/\s+/g, " ").slice(0, 24);
    if (t.length > 0) return t;
  }
  return randomNickname();
}
