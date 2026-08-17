import type { NextConfig } from "next";
import { PROXY_CLIENT_MAX_BODY_MB } from "./src/lib/uploadLimits";

const nextConfig: NextConfig = {
  // 개발 모드 좌측 하단 Next.js 인디케이터(까만 N 버튼) 숨김 — 패널 UI와 겹쳐 거슬림. 운영 빌드엔 영향 없음.
  devIndicators: false,
  // middleware(프록시) 본문 버퍼 — src/lib/uploadLimits.ts 와 동기화(관리자 상한 합).
  experimental: {
    proxyClientMaxBodySize: `${PROXY_CLIENT_MAX_BODY_MB}mb`,
  },
};

export default nextConfig;
