import { Fragment, type ReactNode } from "react";

/**
 * 한 줄짜리 LLM 텍스트(체크리스트 항목·위반사항·근거규정 등)에서
 * 마크다운 강조 기호를 정리해 plain 영역에 안전하게 노출한다.
 * - 줄머리 목록기호(`* `, `- `, `# `)는 제거하되 `1. ` 같은 번호는 유지.
 * - `**굵게**` / `__굵게__` 는 span으로 굵게 렌더, `*기울임*`·`` `코드` `` 기호는 제거.
 * (블록 마크다운은 LlmMarkdown을 쓰고, 이 컴포넌트는 인라인 한 줄용이다.)
 */
function stripLineMarkers(s: string): string {
  // 줄머리 #, *, - 불릿만 제거 ("1. " 번호 목록은 유지)
  return s.replace(/^\s*(?:#{1,6}\s+|[*\-]\s+)/, "").trim();
}

/** `**굵게**`·`__굵게__`만 span으로 살리고 나머지 강조기호(`*`,`` ` ``)는 제거. */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((part, i) => {
    const bold = part.match(/^(?:\*\*([^*]+)\*\*|__([^_]+)__)$/);
    if (bold) {
      return (
        <strong key={i} className="font-semibold">
          {bold[1] ?? bold[2]}
        </strong>
      );
    }
    // 남은 단독 강조기호 제거(`*기울임*`, `` `코드` `` 등)
    const cleaned = part.replace(/[*`]/g, "");
    return <Fragment key={i}>{cleaned}</Fragment>;
  });
}

/** 인라인 마크다운 강조를 정리한 plain 텍스트를 출력한다. */
export function InlineMd({ children }: { children: string }) {
  return <>{renderInline(stripLineMarkers(children))}</>;
}
