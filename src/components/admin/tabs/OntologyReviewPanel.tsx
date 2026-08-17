"use client";

/**
 * 근거 재검토 — 개정으로 격리된 업무 근거를 사람이 판단해 정리한다.
 *
 * 격리는 자동이지만 해소는 사람의 몫이다. 이 화면이 없으면 격리된 근거를 스크립트로만 풀 수 있고,
 * 그동안 해당 업무는 근거 없이 남는다. 업무 단위로 묶은 이유는 같은 개정에서 나온 변경이
 * 대개 같은 판단을 받기 때문이다.
 */

import { useCallback, useEffect, useState } from "react";
import { InlineDiff } from "@/components/admin/InlineDiff";

type Item = {
  edgeKey: string; rel: string; status: string;
  task: string; taskLabel: string;
  doc: string; name: string;
  reason: string; since: string | null;
  before: string; after: string; afterKind: "row" | "article" | "gone";
  docExists: boolean; isRow: boolean;
};
type Group = { task: string; taskLabel: string; items: Item[] };

const REASON_LABEL: Record<string, string> = {
  "text-changed": "본문 변경",
  "row-changed": "해당 행 변경",
  "article-removed": "조문 소실",
  "doc-removed": "문서 삭제",
};
const REASON_HINT: Record<string, string> = {
  "text-changed": "근거 조문의 본문이 바뀌었습니다. 지금 원문이 여전히 이 업무의 근거인지 확인하세요.",
  "row-changed": "근거로 삼던 행이 바뀌었습니다. 오른쪽이 현재 원문에서 가장 가까운 행입니다.",
  "article-removed": "근거 조문이 사라졌습니다. 다른 조문으로 옮겨졌다면 교체하세요.",
  "doc-removed": "근거 문서 자체가 삭제됐습니다. 대체 근거가 없으면 삭제하세요.",
};

export function OntologyReviewPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/admin/ontology/stale", { cache: "no-store" }).then((r) => r.json());
      if (j.ok) { setGroups(j.groups); setTotal(j.total); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: "keep" | "remove" | "replace", edgeKeys: string[], target?: { doc: string; name: string; anchorText?: string }) => {
    if (action === "remove" && !window.confirm(`근거 ${edgeKeys.length}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true); setMsg("");
    try {
      const j = await fetch("/api/admin/ontology/resolve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, edgeKeys, target }),
      }).then((r) => r.json());
      if (!j.ok) { setMsg(`실패: ${j.error ?? "알 수 없는 오류"}`); return; }
      const n = j.resolved ?? j.removed ?? 0;
      const bad = (j.failed ?? []) as { reason: string }[];
      setMsg(`${action === "remove" ? "삭제" : action === "keep" ? "유지" : "교체"} ${n}건 완료${bad.length ? ` · 실패 ${bad.length}건(${bad[0].reason})` : ""}`);
      setReplaceFor(null);
      await load();
    } finally { setBusy(false); }
  }, [load]);

  if (loading) return <p className="py-8 text-center text-sm text-[var(--ax-text-muted)]">불러오는 중…</p>;

  if (!total) {
    return (
      <div className="rounded-lg border border-[var(--ax-border)] px-4 py-10 text-center">
        <p className="text-sm font-bold text-[#1d7a44]">재검토할 근거가 없습니다.</p>
        <p className="mt-1.5 text-xs text-[var(--ax-text-muted)]">
          규정을 개정하면 어긋난 근거가 자동으로 격리되어 여기에 쌓입니다. 격리된 근거는 그동안 화면에 노출되지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          재검토 <span className="font-bold text-[#d14343]">{total}건</span>
          <span className="ml-1.5 text-[var(--ax-text-muted)]">· 업무 {groups.length}개 · 조치할 때까지 화면에 노출되지 않습니다</span>
        </p>
        {msg && <p className="text-sm text-[var(--ax-accent)]">{msg}</p>}
      </div>

      <div className="space-y-2.5">
        {groups.map((g) => {
          const isOpen = open === g.task;
          const keys = g.items.map((i) => i.edgeKey);
          return (
            <div key={g.task} className="rounded-lg border border-[var(--ax-border)]">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <button onClick={() => setOpen(isOpen ? null : g.task)} className="flex items-center gap-2 text-left">
                  <span className="material-symbols-outlined text-[18px] text-[var(--ax-text-muted)]">{isOpen ? "expand_more" : "chevron_right"}</span>
                  <span className="font-bold">{g.taskLabel}</span>
                  <span className="rounded-full bg-[#fdeaea] px-2 py-0.5 text-xs text-[#d14343]">근거 {g.items.length}건</span>
                </button>
                {g.items.length > 1 && (
                  <button
                    onClick={() => void act("keep", keys)}
                    disabled={busy}
                    className="rounded-md border border-[var(--ax-border)] px-2.5 py-1 text-xs hover:bg-[var(--ax-border-soft)] disabled:opacity-50"
                    title="이 업무의 격리된 근거 전부를 현재 원문 기준으로 되살립니다"
                  >
                    전부 유지
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="space-y-3 border-t border-[var(--ax-border)] px-3 py-3">
                  {g.items.map((it) => (
                    <div key={it.edgeKey} className="rounded-md bg-[var(--ax-border-soft)] p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="rounded bg-[#fdeaea] px-1.5 py-0.5 text-[#d14343]">{REASON_LABEL[it.reason] ?? it.reason}</span>
                        <span className="rounded bg-[var(--ax-card)] px-1.5 py-0.5">{it.rel}</span>
                        <span className="text-[var(--ax-text-muted)]">{it.doc} {it.name}</span>
                        {it.isRow && <span className="text-[var(--ax-text-hint)]">· 행 단위 근거</span>}
                      </div>
                      <p className="mb-2 text-xs text-[var(--ax-text-muted)]">{REASON_HINT[it.reason] ?? ""}</p>

                      {it.afterKind === "gone" ? (
                        <p className="rounded bg-[var(--ax-card)] p-2 text-sm text-[#d14343]">
                          현재 원문에서 찾을 수 없습니다. 격리 시점 인용: <span className="text-[var(--ax-text-muted)]">{it.before || "(없음)"}</span>
                        </p>
                      ) : (
                        <div className="rounded bg-[var(--ax-card)] p-2 text-sm">
                          <p className="mb-1 text-xs text-[var(--ax-text-muted)]">
                            격리 시점 → 현재 원문{it.afterKind === "article" ? " (조문 전체)" : " (가장 가까운 행)"}
                          </p>
                          <InlineDiff oldText={it.before} newText={it.after} />
                        </div>
                      )}

                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => void act("keep", [it.edgeKey])}
                          disabled={busy || it.afterKind === "gone"}
                          className="rounded-md bg-[var(--ax-accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                          title={it.afterKind === "gone" ? "원문이 없어 유지할 수 없습니다" : "현재 원문으로 앵커를 갱신하고 격리를 해제합니다"}
                        >
                          근거 유지
                        </button>
                        <button
                          onClick={() => setReplaceFor(replaceFor?.edgeKey === it.edgeKey ? null : it)}
                          disabled={busy}
                          className="rounded-md border border-[var(--ax-border)] px-3 py-1.5 text-xs hover:bg-[var(--ax-card)] disabled:opacity-50"
                        >
                          근거 교체
                        </button>
                        <button
                          onClick={() => void act("remove", [it.edgeKey])}
                          disabled={busy}
                          className="rounded-md border border-[var(--ax-border)] px-3 py-1.5 text-xs text-[#d14343] hover:bg-[#fdeaea] disabled:opacity-50"
                        >
                          근거 삭제
                        </button>
                      </div>

                      {replaceFor?.edgeKey === it.edgeKey && <ReplaceForm item={it} busy={busy} onSubmit={(t) => void act("replace", [it.edgeKey], t)} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 근거 교체 — 새 조문 위치를 지정한다. 행 단위 근거였다면 행 문구까지 받아야 앵커가 유지된다. */
function ReplaceForm({ item, busy, onSubmit }: { item: Item; busy: boolean; onSubmit: (t: { doc: string; name: string; anchorText?: string }) => void }) {
  const [doc, setDoc] = useState(item.doc);
  const [name, setName] = useState(item.name);
  const [anchorText, setAnchorText] = useState(item.isRow ? item.before : "");
  return (
    <div className="mt-2.5 space-y-1.5 rounded-md border border-[var(--ax-border)] bg-[var(--ax-card)] p-2.5">
      <p className="text-xs text-[var(--ax-text-muted)]">새 근거 위치 — 조문명은 원문 표기 그대로여야 합니다.</p>
      <input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="규정명" className="w-full rounded border border-[var(--ax-border)] px-2 py-1 text-sm" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="조문명 (예: 제12조(계약의 체결))" className="w-full rounded border border-[var(--ax-border)] px-2 py-1 text-sm" />
      {item.isRow && (
        <input value={anchorText} onChange={(e) => setAnchorText(e.target.value)} placeholder="행 문구 (별표의 해당 행)" className="w-full rounded border border-[var(--ax-border)] px-2 py-1 text-sm" />
      )}
      <button
        onClick={() => onSubmit({ doc: doc.trim(), name: name.trim(), anchorText: anchorText.trim() || undefined })}
        disabled={busy || !doc.trim() || !name.trim()}
        className="rounded-md bg-[var(--ax-accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
      >
        이 위치로 교체
      </button>
    </div>
  );
}
