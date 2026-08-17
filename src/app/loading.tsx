/**
 * 페이지 전환 시 즉시 표시 — 서버 렌더·DB 대기 중에도 빈 화면 대신 스켈레톤으로 체감 속도 개선
 */
export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="h-16 border-b border-gray-200 bg-white animate-pulse" />
      <div className="flex-1 max-w-[1600px] w-full mx-auto p-6 space-y-6">
        <div className="h-32 rounded-2xl bg-gradient-to-r from-blue-100 to-blue-50 animate-pulse" />
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 space-y-4">
            <div className="h-48 rounded-2xl bg-white border border-gray-100 shadow-sm animate-pulse" />
            <div className="h-40 rounded-2xl bg-white border border-gray-100 shadow-sm animate-pulse" />
          </div>
          <div className="col-span-12 lg:col-span-4 space-y-4">
            <div className="h-56 rounded-2xl bg-white border border-gray-100 shadow-sm animate-pulse" />
            <div className="h-48 rounded-2xl bg-white border border-gray-100 shadow-sm animate-pulse" />
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-gray-400 pb-4">로딩 중…</p>
    </div>
  );
}
