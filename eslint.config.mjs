import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 원시 LLM 호출(chatLlm/streamChatLlm/askLlm)은 가드레일 게이트(@/lib/guardrails)만 쓰도록 강제.
  // 허용목록: 게이트웨이 자신 + LLM 도달성 프로브 2곳(고정 프롬프트·사용자 입력 없음) + 오프라인 배치 스크립트.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/llm.ts",
      "src/lib/guardrails/**",
      "src/app/api/ai/status/route.ts",
      "src/app/api/admin/settings/test/route.ts",
      // 오프라인 배치/생성·평가 스크립트: 사용자 요청 경로가 아니라 개발자 수동 실행 도구 → 게이트 예외.
      "src/scripts/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/llm",
              importNames: ["chatLlm", "streamChatLlm", "askLlm"],
              message:
                "원시 LLM 호출은 가드레일 게이트(@/lib/guardrails의 guardedChat/guardedStreamChat)를 경유하세요. 헬스체크 프로브 예외는 eslint.config.mjs 허용목록 참고.",
            },
          ],
        },
      ],
    },
  },
  // 기존 컴포넌트의 의도된 패턴(SSR 마운트 복원·reset-on-dep·latest-ref)을 지적하는 react-hooks
  // 신규 규칙을 전환기 동안 warn으로 완화(가시성 유지). 추후 컴포넌트별 정식 리팩터 후 error 복귀 권장.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // HTML 템플릿 조각(진짜 JS 아님 — <script>로 시작, __DATA__ 치환용): lint 대상 제외.
    "tools/review-package/template-script.js",
  ]),
]);

export default eslintConfig;
