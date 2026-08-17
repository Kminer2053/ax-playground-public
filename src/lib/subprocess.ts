import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Semaphore } from "./semaphore";
import { env } from "./env";

const _raw = promisify(execFile);

/**
 * 무거운 자식 프로세스(Python HWPX 빌더·OCR·kordoc CLI)가 다수 요청에서 동시에 쏟아져
 * CPU/메모리를 고갈시키는 것을 막는 전역 동시 실행 상한(C3). 모든 호출처(문서빌드·OCR·
 * 문서파싱)가 하나의 세마포어로 총량을 공유한다. 단일 인스턴스 전제(프로세스-로컬).
 */
const _subprocSem = new Semaphore(env.SUBPROC_MAX_CONCURRENCY, env.SUBPROC_MAX_QUEUE);

/** 세마포어로 동시 실행을 제한한 execFile. 타입·인터페이스는 promisify(execFile)과 동일. */
export const execFileLimited = ((...callArgs: Parameters<typeof _raw>) =>
  _subprocSem.run(() => _raw(...callArgs))) as unknown as typeof _raw;
