/**
 * 이전 버전: Ollama로 ragChunks/embedding 생성.
 * 현재는 참조 AX_Portal과 동일하게 rag_regulation이 통본 content + 텍스트 검색만 사용합니다.
 * 재임베딩이 필요 없습니다. 사규는 npm run seed:regulations 로 다시 넣으세요.
 */
import "./load-env";

console.log("[reembed-regulations] 사규 RAG는 임베딩을 사용하지 않습니다. 종료.");
process.exitCode = 0;
