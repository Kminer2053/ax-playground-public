/**
 * 경량 비동기 세마포어 — 동시 실행 수를 제한하고, 대기열이 가득 차면 즉시 거절(백프레셔).
 * 단일 프로세스(단일 인스턴스 배포) 전제의 프로세스-로컬 게이트.
 * 용도: 내부 LLM 동시 호출 상한(C2), 추후 파이썬 서브프로세스 동시 실행 상한(C3) 등.
 */

/** 동시 실행+대기열 한도를 모두 초과했을 때 던진다(호출 측에서 503 등으로 매핑). */
export class CapacityError extends Error {
  constructor(message = "처리 용량을 초과했습니다.") {
    super(message);
    this.name = "CapacityError";
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  /**
   * @param maxConcurrent 동시에 실행 가능한 최대 작업 수
   * @param maxQueue 대기 가능한 최대 작업 수(초과 시 acquire가 CapacityError)
   */
  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
  ) {}

  /** 슬롯 획득. 반환된 함수를 반드시(예: finally) 호출해 해제한다. 용량 초과 시 CapacityError. */
  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
    } else {
      if (this.waiters.length >= this.maxQueue) throw new CapacityError();
      // 슬롯은 release()가 깨워줄 때 '인계'된다(active 카운트는 그대로 유지).
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next(); // 대기자에게 슬롯 인계(active 유지)
      else this.active--; // 빈 슬롯 반납
    };
  }

  /** fn을 슬롯 안에서 실행하고 자동 해제(비-제너레이터용 편의 래퍼). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** 진단용 현재 상태. */
  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiters.length };
  }
}
