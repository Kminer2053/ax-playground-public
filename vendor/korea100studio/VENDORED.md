# Vendored: korea100studio (board-v1 렌더러)

출처: https://github.com/hosungseo/korea100studio (MIT, © 2026 Hosung Seo)
반입 범위: scripts/board.mjs + scripts/lib/*.mjs (렌더·검증·모션·레이아웃·프로필). 순수 ESM.
런타임 의존성: ajv (메인 리포 node_modules에서 해소 — 별도 반입 불필요).
용도(업무100): board-v1 스윔레인 SVG 렌더캐시 생성(정적+모션), validate/audit 게이트.
sample 프로필은 scripts/lib/profiles.mjs 내장(무한성 warm 팔레트).
