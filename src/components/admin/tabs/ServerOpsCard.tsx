"use client";

/**
 * 설정 탭 — 배포·재시작 카드.
 * /api/admin/ops 로 서버의 deploy.sh / restart.sh 를 실행하고 로그를 폴링해 보여준다.
 * 재시작 중에는 앱이 잠시 내려가 GET이 실패하므로, 실패를 "재시작 진행 중"으로 간주하고 폴링을 계속한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Op = {
  action: "deploy" | "restart";
  label: string;
  startedAt: string;
  running: boolean;
};

const cardCls = "rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm";
const btnPrimary =
  "rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50";
const btnDanger =
  "rounded-lg border border-[var(--ax-danger)] px-4 py-2 text-sm font-bold text-[var(--ax-danger)] hover:bg-red-50 disabled:opacity-50";

const CONFIRM_TEXT: Record<Op["action"], string> = {
  deploy:
    "origin/main 최신 소스를 받아 빌드 후 서버를 재시작합니다.\n변경 파일은 자동 백업되며, 빌드에 수 분이 걸릴 수 있습니다.\n진행하시겠습니까?",
  restart: "PM2로 서버를 재시작합니다. 몇 초간 접속이 끊길 수 있습니다.\n진행하시겠습니까?",
};

export function ServerOpsCard() {
  const [op, setOp] = useState<Op | null>(null);
  const [log, setLog] = useState("");
  const [polling, setPolling] = useState(false);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/ops", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) return;
      setOffline(false);
      setOp(d.op);
      setLog(d.log ?? "");
      if (d.op && !d.op.running) {
        setPolling(false);
        setMsg({ ok: true, text: `${d.op.label} 작업이 종료되었습니다. 로그를 확인하세요.` });
      }
    } catch {
      // 재시작으로 서버가 잠시 내려간 상태 — 폴링을 계속해 복구를 감지
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    if (!op?.running && !polling) return;
    const id = setInterval(() => void poll(), 2000);
    return () => clearInterval(id);
  }, [op?.running, polling, poll]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const run = async (action: Op["action"]) => {
    if (!window.confirm(CONFIRM_TEXT[action])) return;
    setMsg(null);
    try {
      const r = await fetch("/api/admin/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (d.ok) {
        setOp(d.op);
        setPolling(true);
        setMsg({ ok: true, text: `${d.op.label} 작업을 시작했습니다.` });
      } else {
        setMsg({ ok: false, text: d.error ?? "실행 실패" });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const busy = Boolean(op?.running) || offline;

  return (
    <div className={cardCls}>
      <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">배포·재시작</div>
      <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
        배포 서버의 스크립트를 실행합니다. <b>소스 반영</b>은 origin/main 을 받아 백업 → 빌드 → 재시작까지 수행하고(수 분 소요),{" "}
        <b>서버 재시작</b>은 PM2 재시작만 수행합니다. 실행 중에는 접속이 잠시 끊길 수 있습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => run("deploy")} disabled={busy} className={btnPrimary}>
          {op?.running && op.action === "deploy" ? "배포 진행 중…" : "소스 반영 (deploy.sh)"}
        </button>
        <button onClick={() => run("restart")} disabled={busy} className={btnDanger}>
          {op?.running && op.action === "restart" ? "재시작 진행 중…" : "서버 재시작 (restart.sh)"}
        </button>
        {offline && (
          <span className="text-xs font-semibold text-[var(--ax-warning,#b45309)]">
            서버 응답 없음 — 재시작 진행 중일 수 있습니다. 자동으로 재연결합니다…
          </span>
        )}
        {msg && !offline && (
          <span className={`text-xs ${msg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{msg.text}</span>
        )}
      </div>
      {op && (
        <div className="mt-3">
          <div className="mb-1 text-xs text-[var(--ax-text-muted)]">
            최근 작업: <b>{op.label}</b> · {new Date(op.startedAt).toLocaleString()} ·{" "}
            {op.running ? <span className="font-semibold text-[var(--ax-accent)]">실행 중</span> : "종료"}
          </div>
          {log && (
            <pre
              ref={logRef}
              className="max-h-64 overflow-auto rounded-lg bg-[#111] p-3 text-[11px] leading-relaxed text-[#d4d4d4]"
            >
              {log}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
