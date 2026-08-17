/**
 * 암호학적 안전 난수 유틸 (서버·클라이언트 공용).
 *
 * Web Crypto의 getRandomValues를 사용한다. crypto.randomUUID()와 달리
 * 보안 컨텍스트(HTTPS·localhost)가 아니어도 동작하므로, 폐쇄망을 http로
 * 서비스하는 환경에서도 예측 불가능한 난수를 얻을 수 있다.
 *
 * Math.random()은 예측 가능한 의사난수(CWE-330)이므로 사용하지 않는다.
 */

function webCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("Web Crypto API(getRandomValues)를 사용할 수 없는 런타임입니다.");
  }
  return c;
}

/**
 * [0, maxExclusive) 범위의 균등 정수.
 * 2^32를 maxExclusive로 나눈 절단점 밖의 값은 버려(rejection sampling) 모듈로 편향을 제거한다.
 */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive는 1 이상의 정수여야 합니다.");
  }
  if (maxExclusive === 1) return 0;
  const c = webCrypto();
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  let v: number;
  do {
    c.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % maxExclusive;
}

/** Fisher-Yates 균등 셔플(원본 불변). sort(() => Math.random() - 0.5)의 분포 편향도 함께 해소한다. */
export function secureShuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 예측 불가능한 hex 식별자(기본 16바이트=128비트). */
export function secureRandomId(bytes = 16): string {
  const b = new Uint8Array(bytes);
  webCrypto().getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
