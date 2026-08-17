"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  format: string;
  label: string;
  hasStandard: boolean;
  size: number;
  mtime: string | null;
  slots: number | null;
};

export function DocTemplateTab() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ format: string; text: string; ok: boolean } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/admin/doc-templates").then((r) => r.json());
      setItems(d.ok ? d.items : []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (format: string, file: File) => {
    setBusy(format);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("format", format);
      fd.set("file", file);
      const d = await fetch("/api/admin/doc-templates", { method: "POST", body: fd }).then((r) => r.json());
      if (d.ok) {
        setMsg({ format, text: `표준서식 교체 완료 — 골격 ${d.slots ?? "?"}개 슬롯 생성. 즉시 문서 생성에 반영됩니다.`, ok: true });
        void load();
      } else {
        setMsg({ format, text: d.error || "업로드 실패", ok: false });
      }
    } catch {
      setMsg({ format, text: "업로드 중 오류가 발생했습니다.", ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 text-sm text-[var(--ax-text-muted)]">
        각 양식의 <b>표준 hwpx</b>를 교체하면, 그 양식의 폰트·표·테두리·색 등 시각 서식이 그대로 보존된 채
        AI가 내용만 채웁니다. 업로드 시 <b>빈 골격(skeleton)</b>이 자동 생성되어 즉시 반영됩니다.
        <span className="mt-1 block text-xs text-[var(--ax-text-hint)]">보도자료는 머리표·인용문 구조상 전용 빌더(문단 치환)를 쓰며, 여기서는 표준 hwpx 파일만 교체합니다(머리표 라벨 구조 유지 필요).</span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.format} className="rounded-xl border border-[var(--ax-border)] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--ax-text)]">
                    {it.label} <span className="ml-1 text-xs font-normal text-[var(--ax-text-hint)]">({it.format})</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--ax-text-hint)]">
                    {it.hasStandard ? (
                      <>표준 {(it.size / 1024).toFixed(0)}KB · {it.slots != null ? `골격 ${it.slots}슬롯` : "전용 빌더"}
                        {it.mtime ? ` · ${new Date(it.mtime).toLocaleDateString("ko-KR")}` : ""}</>
                    ) : (
                      <span className="text-[var(--ax-danger)]">표준 파일 없음</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-none gap-2">
                  <a
                    href={`/api/admin/doc-templates/${it.format}`}
                    className="rounded-lg border border-[var(--ax-border)] px-3 py-1.5 text-sm font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]"
                  >
                    ⬇ 현재 표준
                  </a>
                  <input
                    ref={(el) => { fileRefs.current[it.format] = el; }}
                    type="file"
                    accept=".hwpx"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(it.format, f); e.target.value = ""; }}
                  />
                  <button
                    onClick={() => fileRefs.current[it.format]?.click()}
                    disabled={busy === it.format}
                    className="rounded-lg bg-[var(--ax-accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {busy === it.format ? "처리 중…" : "표준 교체"}
                  </button>
                </div>
              </div>
              {msg?.format === it.format && (
                <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-[var(--ax-danger-bg)] text-[var(--ax-danger)]"}`}>
                  {msg.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
