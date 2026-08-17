/**
 * 시드/스크립트 실행 시 .env.local 을 맨 먼저 로드.
 * import "./load-env" 를 스크립트 최상단에 두세요.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
