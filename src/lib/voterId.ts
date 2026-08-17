/**
 * 익명 투표 식별자 + 내 투표 기록 (클라이언트 localStorage).
 * 로그인 없는 환경에서 좋아요/싫어요 중복·토글을 위해 사용.
 */
import { secureRandomId } from "@/lib/random";

const ID_KEY = "axp-voter-id";
const VOTES_KEY = "axp-votes";

export function getVoterId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    // crypto.randomUUID()는 보안 컨텍스트(HTTPS·localhost) 전용이라 http 내부망에서 undefined가 된다.
    // getRandomValues 기반 secureRandomId는 비보안 컨텍스트에서도 동작한다. (기존 저장 ID는 그대로 유지)
    id = secureRandomId(16);
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export type Dir = "up" | "down";

export function getMyVotes(): Record<string, Dir> {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(localStorage.getItem(VOTES_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** 투표 기록 갱신(my=null이면 취소). 갱신된 전체 맵 반환. */
export function setMyVote(postId: string, my: Dir | null): Record<string, Dir> {
  const votes = getMyVotes();
  if (my) votes[postId] = my;
  else delete votes[postId];
  if (typeof window !== "undefined") localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  return votes;
}
