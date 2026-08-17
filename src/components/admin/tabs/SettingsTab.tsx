"use client";

import { useCallback, useEffect, useState } from "react";
import { ServerOpsCard } from "./ServerOpsCard";
import { NoticeManageCard } from "./NoticeManageCard";
import {
  DEFAULT_PANEL_CONTRIB,
  PANEL_BADGE_LABEL,
  PANEL_INTRO_KEYS,
  PANEL_INTRO_TEXT,
  type PanelBadgeKind,
  type PanelContrib,
} from "@/lib/panel-intro";
import { BUILDINGS, CORE_BUILDING_IDS, type BuildingOverride } from "@/lib/playground-map";

type Settings = {
  orgName: string;
  ceoName: string;
  panelIntro: Record<string, PanelContrib>;
  panelOverrides: Record<string, BuildingOverride>;
  llmBaseUrl: string;
  llmDefaultModel: string;
  featureModels: Record<string, string>;
  uploadImageMb: number;
  uploadFileMb: number;
  ragVectorEnabled: boolean;
  ragGraphEnabled: boolean;
  embedBaseUrl: string;
  embedModel: string;
  embedDims: number;
  adminAllowedIps: string;
  hasApiKey: boolean;
  hasAdminKey: boolean;
  hasSafetyPw: boolean;
  uploadLimits?: { maxImageMb: number; maxFileMb: number; proxyBodyMb: number };
};

// LLM(채팅)을 사용하는 패널 = 가드레일 GuardPanel 키. 기능(API)별 모델을 지정.
const LLM_FEATURES: { key: string; label: string }[] = [
  { key: "knowledge", label: "AI 지식검색" },
  { key: "sales", label: "AI 매출분석" },
  { key: "docs", label: "AI 문서작성" },
  { key: "cs", label: "AI 민원답변" },
  { key: "ad", label: "AI 광고도안심의" },
  { key: "safety", label: "스마트 안전관리" },
  { key: "pr", label: "AI 리서치매거진" },
  { key: "ai", label: "AI 통합 채팅" },
];

type TestState = { busy?: boolean; ok?: boolean; text?: string };

/** 스플래시 기여자 편집용 — 배열은 콤마 문자열로 다룬다(입력 중 공백 허용). */
type ContribDraft = { ideaBy: string; codeBy: string; badge: PanelBadgeKind | "" };

const BADGE_OPTIONS: { value: PanelBadgeKind | ""; label: string }[] = [
  { value: "", label: "표시 안 함" },
  { value: "contest", label: PANEL_BADGE_LABEL.contest },
  { value: "ceo", label: PANEL_BADGE_LABEL.ceo },
  { value: "demand", label: PANEL_BADGE_LABEL.demand },
];

function toDrafts(saved?: Record<string, PanelContrib> | null): Record<string, ContribDraft> {
  const out: Record<string, ContribDraft> = {};
  for (const k of PANEL_INTRO_KEYS) {
    const c = saved?.[k] ?? DEFAULT_PANEL_CONTRIB[k];
    out[k] = { ideaBy: (c?.ideaBy ?? []).join(", "), codeBy: (c?.codeBy ?? []).join(", "), badge: c?.badge ?? "" };
  }
  return out;
}

function fromDrafts(d: Record<string, ContribDraft>): Record<string, PanelContrib> {
  const out: Record<string, PanelContrib> = {};
  for (const k of PANEL_INTRO_KEYS) {
    const v = d[k];
    if (!v) continue;
    const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    out[k] = { ideaBy: split(v.ideaBy), codeBy: split(v.codeBy), ...(v.badge ? { badge: v.badge } : {}) };
  }
  return out;
}

/** 메인 건물 오버라이드 편집용 — 비운 칸은 코드 기본값 사용을 뜻한다. */
type OverrideDraft = { label: string; desc: string; externalUrl: string; hidden: boolean };

function toOverrideDrafts(saved?: Record<string, BuildingOverride> | null): Record<string, OverrideDraft> {
  const out: Record<string, OverrideDraft> = {};
  for (const b of BUILDINGS) {
    const o = saved?.[b.id];
    out[b.id] = { label: o?.label ?? "", desc: o?.desc ?? "", externalUrl: o?.externalUrl ?? "", hidden: o?.hidden ?? false };
  }
  return out;
}

function fromOverrideDrafts(d: Record<string, OverrideDraft>): Record<string, BuildingOverride> {
  const out: Record<string, BuildingOverride> = {};
  for (const b of BUILDINGS) {
    const v = d[b.id];
    if (!v) continue;
    const entry: BuildingOverride = {};
    if (v.label.trim()) entry.label = v.label.trim();
    if (v.desc.trim()) entry.desc = v.desc.trim();
    if (v.externalUrl.trim()) entry.externalUrl = v.externalUrl.trim();
    if (v.hidden) entry.hidden = true;
    if (Object.keys(entry).length) out[b.id] = entry;
  }
  return out;
}

const inputCls =
  "rounded-lg border border-[var(--ax-border)] px-2.5 py-1.5 text-sm text-[var(--ax-text)] focus:border-[var(--ax-accent)] focus:outline-none";
const cardCls = "rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm";
const btnPrimary =
  "rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[var(--ax-border)] px-3 py-2 text-sm font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)] disabled:opacity-50";

export function SettingsTab() {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [featureModels, setFeatureModels] = useState<Record<string, string>>({});
  const [imageMb, setImageMb] = useState(10);
  const [fileMb, setFileMb] = useState(100);
  const [uploadLimits, setUploadLimits] = useState({ maxImageMb: 2048, maxFileMb: 4096, proxyBodyMb: 6176 });
  const [vectorOn, setVectorOn] = useState(true);
  const [graphOn, setGraphOn] = useState(true);
  const [embedBaseUrl, setEmbedBaseUrl] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [embedDims, setEmbedDims] = useState(0);
  const [adminIps, setAdminIps] = useState("");
  const [orgName, setOrgName] = useState("");
  const [ceoName, setCeoName] = useState("");
  const [intro, setIntro] = useState<Record<string, ContribDraft>>(() => toDrafts(null));
  const [overrides, setOverrides] = useState<Record<string, OverrideDraft>>(() => toOverrideDrafts(null));
  const [embedModels, setEmbedModels] = useState<string[]>([]);
  const [embedModelsMsg, setEmbedModelsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadingEmbedModels, setLoadingEmbedModels] = useState(false);
  const [embedTest, setEmbedTest] = useState<TestState | null>(null);
  const [ragCacheMsg, setRagCacheMsg] = useState("");
  // 무중단 RAG DB 교체(update-rag-db) 후 재시작 없이 인메모리(벡터·BM25) 캐시를 비워 새 DB 반영
  const refreshRagCache = async () => {
    setRagCacheMsg("새로고침 중…");
    try {
      const r = await fetch("/api/admin/rag-cache", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setRagCacheMsg(r.ok && d.ok ? "✓ 캐시 비움 — 다음 검색부터 새 DB 기준으로 동작합니다" : `✗ ${d.error || "실패"}`);
    } catch {
      setRagCacheMsg("✗ 요청 실패");
    }
  };

  const [models, setModels] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  const [test, setTest] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [oldKey, setOldKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newKey2, setNewKey2] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [safetyPw, setSafetyPw] = useState("");
  const [safetyPw2, setSafetyPw2] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyMsg, setSafetyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/settings").then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      const s = r.settings as Settings;
      setLoaded(s);
      setBaseUrl(s.llmBaseUrl);
      setDefaultModel(s.llmDefaultModel);
      setFeatureModels(s.featureModels ?? {});
      setImageMb(s.uploadImageMb);
      setFileMb(s.uploadFileMb);
      setVectorOn(s.ragVectorEnabled ?? true);
      setGraphOn(s.ragGraphEnabled ?? true);
      setEmbedBaseUrl(s.embedBaseUrl ?? "");
      setEmbedModel(s.embedModel ?? "");
      setEmbedDims(s.embedDims ?? 0);
      setAdminIps(s.adminAllowedIps ?? "");
      setOrgName(s.orgName ?? "");
      setCeoName(s.ceoName ?? "");
      setIntro(toDrafts(Object.keys(s.panelIntro ?? {}).length ? s.panelIntro : null));
      setOverrides(toOverrideDrafts(s.panelOverrides ?? null));
      if (s.uploadLimits) setUploadLimits(s.uploadLimits);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsMsg(null);
    try {
      const qs = new URLSearchParams();
      if (baseUrl.trim()) qs.set("baseUrl", baseUrl.trim());
      if (apiKey.trim()) qs.set("apiKey", apiKey.trim());
      const r = await fetch(`/api/admin/settings/models?${qs.toString()}`).then((x) => x.json());
      if (r.ok) {
        setModels(r.models ?? []);
        setModelsMsg({ ok: true, text: `${(r.models ?? []).length}개 모델을 불러왔습니다.` });
      } else {
        setModelsMsg({ ok: false, text: r.error ?? "모델을 불러오지 못했습니다." });
      }
    } catch (e) {
      setModelsMsg({ ok: false, text: (e as Error).message });
    } finally {
      setLoadingModels(false);
    }
  };

  const runTest = async (key: string, model: string) => {
    setTest((t) => ({ ...t, [key]: { busy: true } }));
    try {
      const r = await fetch("/api/admin/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim() || undefined, apiKey: apiKey.trim() || undefined, model: model.trim() || undefined }),
      }).then((x) => x.json());
      setTest((t) => ({
        ...t,
        [key]: r.ok
          ? { ok: true, text: `정상 · ${r.latencyMs}ms · "${r.sample || ""}"` }
          : { ok: false, text: r.error ?? "실패" },
      }));
    } catch (e) {
      setTest((t) => ({ ...t, [key]: { ok: false, text: (e as Error).message } }));
    }
  };

  const loadEmbedModels = async () => {
    setLoadingEmbedModels(true);
    setEmbedModelsMsg(null);
    try {
      const qs = new URLSearchParams();
      if (embedBaseUrl.trim()) qs.set("baseUrl", embedBaseUrl.trim());
      const r = await fetch(`/api/admin/settings/embed-models?${qs.toString()}`).then((x) => x.json());
      if (r.ok) {
        setEmbedModels(r.models ?? []);
        setEmbedModelsMsg({ ok: true, text: `${(r.models ?? []).length}개 모델을 불러왔습니다.` });
      } else {
        setEmbedModelsMsg({ ok: false, text: r.error ?? "모델을 불러오지 못했습니다." });
      }
    } catch (e) {
      setEmbedModelsMsg({ ok: false, text: (e as Error).message });
    } finally {
      setLoadingEmbedModels(false);
    }
  };

  const runEmbedTest = async () => {
    setEmbedTest({ busy: true });
    try {
      const r = await fetch("/api/admin/settings/embed-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: embedBaseUrl.trim() || undefined, model: embedModel.trim() || undefined }),
      }).then((x) => x.json());
      setEmbedTest(
        r.ok
          ? { ok: true, text: `정상 · ${r.dims}차원 · ${r.latencyMs}ms (${r.model})` }
          : { ok: false, text: r.error ?? "실패" },
      );
    } catch (e) {
      setEmbedTest({ ok: false, text: (e as Error).message });
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, unknown> = {
        llmBaseUrl: baseUrl.trim(),
        llmDefaultModel: defaultModel.trim(),
        featureModels,
        uploadImageMb: imageMb,
        uploadFileMb: fileMb,
        ragVectorEnabled: vectorOn,
        ragGraphEnabled: graphOn,
        embedBaseUrl: embedBaseUrl.trim(),
        embedModel: embedModel.trim(),
        embedDims: embedDims,
        adminAllowedIps: adminIps.trim(),
        orgName: orgName.trim(),
        ceoName: ceoName.trim(),
        panelIntro: fromDrafts(intro),
        panelOverrides: fromOverrideDrafts(overrides),
      };
      if (apiKey.trim()) payload.llmApiKey = apiKey.trim();
      const r = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((x) => x.json());
      if (r.ok) {
        setApiKey("");
        await load();
        setSaveMsg({ ok: true, text: "설정을 저장했습니다." });
      } else {
        setSaveMsg({ ok: false, text: r.error ?? "저장 실패" });
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const changeKey = async () => {
    setKeyMsg(null);
    if (newKey.length < 8) { setKeyMsg({ ok: false, text: "새 암호는 8자 이상이어야 합니다." }); return; }
    if (newKey !== newKey2) { setKeyMsg({ ok: false, text: "새 암호 확인이 일치하지 않습니다." }); return; }
    setKeyBusy(true);
    try {
      const r = await fetch("/api/admin/settings/admin-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldKey, newKey }),
      }).then((x) => x.json());
      if (r.ok) {
        setOldKey(""); setNewKey(""); setNewKey2("");
        setKeyMsg({ ok: true, text: "관리자 암호를 변경했습니다. 다음 로그인부터 새 암호를 사용하세요." });
        void load();
      } else {
        setKeyMsg({ ok: false, text: r.error ?? "변경 실패" });
      }
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    } finally {
      setKeyBusy(false);
    }
  };

  const saveSafetyPw = async (clear?: boolean) => {
    setSafetyMsg(null);
    if (!clear) {
      if (safetyPw.length < 4) { setSafetyMsg({ ok: false, text: "비밀번호는 4자 이상이어야 합니다." }); return; }
      if (safetyPw !== safetyPw2) { setSafetyMsg({ ok: false, text: "비밀번호 확인이 일치하지 않습니다." }); return; }
    }
    setSafetyBusy(true);
    try {
      const r = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ safetyBoardPw: clear ? "" : safetyPw }),
      }).then((x) => x.json());
      if (r.ok) {
        setSafetyPw(""); setSafetyPw2("");
        setSafetyMsg({ ok: true, text: clear ? "안전 게시판 비밀번호를 해제했습니다." : "안전 게시판 비밀번호를 설정했습니다." });
        await load();
      } else {
        setSafetyMsg({ ok: false, text: r.error ?? "저장 실패" });
      }
    } catch (e) {
      setSafetyMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSafetyBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE", credentials: "include" }).catch(() => {});
    window.location.href = "/";
  };

  const setFM = (k: string, v: string) => setFeatureModels((m) => ({ ...m, [k]: v }));
  const setIntroField = (k: string, f: keyof ContribDraft, v: string) =>
    setIntro((m) => ({ ...m, [k]: { ...m[k], [f]: v } as ContribDraft }));
  const setOvField = (k: string, f: keyof OverrideDraft, v: string | boolean) =>
    setOverrides((m) => ({ ...m, [k]: { ...m[k], [f]: v } as OverrideDraft }));

  return (
    <div className="max-w-3xl space-y-5">
      {/* 공지 팝업 — 운영자가 가장 자주 손대는 항목이라 위에 둔다 */}
      <NoticeManageCard />

      {/* 기관 정보 — 기관마다 다른 값이라 코드가 아닌 설정으로 둔다 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">기관 정보</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          AI 문서작성(보도자료 등)에서 쓰는 기관명·대표자입니다. 대표자를 비우면 <code>○○○</code> 로 표기됩니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">기관명</span>
            <input value={orgName ?? ""} onChange={(e) => setOrgName(e.target.value)} placeholder="예: ○○공사" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">대표자 성명</span>
            <input value={ceoName ?? ""} onChange={(e) => setCeoName(e.target.value)} placeholder="비우면 ○○○ 로 표기" className={inputCls} />
          </label>
        </div>
      </div>

      {/* 메인 건물(기능) 구성 — 기관별 커스터마이징 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">메인 건물(기능) 구성</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          메인화면 건물의 <b>이름·설명</b>을 기관에 맞게 바꾸고, 필요하면 <b>기관 자체 웹앱 URL</b>을 연계하거나 건물을 <b>숨길</b> 수 있습니다.
          비운 칸은 기본값을 사용합니다. 외부 URL을 설정한 건물은 클릭 시 해당 웹앱이 <b>새 탭</b>으로 열립니다.
          <br />🧱 <b>핵심 4기능</b>(리더보드·라이브러리·지식검색·문서작성)은 플랫폼 기본기라 외부 연계·숨김이 되지 않습니다(이름·설명 변경은 가능).
        </p>
        <div className="space-y-2">
          {BUILDINGS.map((b) => {
            const core = CORE_BUILDING_IDS.includes(b.id);
            const d = overrides[b.id] ?? { label: "", desc: "", externalUrl: "", hidden: false };
            return (
              <div key={b.id} className="rounded-lg border border-[var(--ax-border-soft)] bg-[var(--ax-surface-soft,#fafafa)] px-3 py-2">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: b.color }}>{b.no}</span>
                  <span className="text-sm font-semibold text-[var(--ax-text)]">{b.label}</span>
                  {core && <span className="rounded bg-[var(--ax-border-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--ax-text-muted)]">핵심 기능</span>}
                  {!core && (
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--ax-text-muted)]">
                      <input type="checkbox" checked={d.hidden} onChange={(e) => setOvField(b.id, "hidden", e.target.checked)} />
                      메인에서 숨김
                    </label>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input value={d.label} maxLength={16} onChange={(e) => setOvField(b.id, "label", e.target.value)} placeholder={`이름 (기본: ${b.label})`} className={inputCls} />
                  <input value={d.desc} maxLength={30} onChange={(e) => setOvField(b.id, "desc", e.target.value)} placeholder={`설명 (기본: ${b.desc})`} className={inputCls} />
                  <input
                    value={d.externalUrl}
                    onChange={(e) => setOvField(b.id, "externalUrl", e.target.value)}
                    placeholder={core ? "외부 연계 불가(내부 기능)" : "외부 웹앱 URL (비우면 내부 기능)"}
                    disabled={core}
                    className={`${inputCls} disabled:bg-[var(--ax-border-soft)] disabled:text-[var(--ax-text-hint)]`}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--ax-text-hint)]">이름은 16자, 설명은 30자까지입니다(메인 라벨 카드 폭 제한). 아래 <b>[설정 저장]</b> 을 눌러야 반영됩니다.</p>
      </div>

      {/* 패널 스플래시 기여자 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">패널 소개 스플래시 — 기여자·배지</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          각 패널에 처음 들어갈 때 뜨는 소개 화면의 <b>아이디어·코드개발 기여자</b>와 <b>출처 배지</b>입니다.
          이름은 콤마로 구분하고, 역할 문구는 이름 앞에 그대로 적으면 됩니다(예: <code>프로토타입 김하늘</code>). 비우면 해당 줄이 숨겨집니다.
        </p>
        <div className="space-y-2">
          {PANEL_INTRO_KEYS.map((k) => {
            const d = intro[k] ?? { ideaBy: "", codeBy: "", badge: "" as const };
            return (
              <div key={k} className="rounded-lg border border-[var(--ax-border-soft)] bg-[var(--ax-surface-soft,#fafafa)] px-3 py-2">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ax-text)]">{k}</span>
                  <span className="text-xs text-[var(--ax-text-hint)]">{PANEL_INTRO_TEXT[k]?.intro.slice(0, 34)}…</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input value={d.ideaBy ?? ""} onChange={(e) => setIntroField(k, "ideaBy", e.target.value)} placeholder="아이디어 (콤마 구분)" className={inputCls} />
                  <input value={d.codeBy ?? ""} onChange={(e) => setIntroField(k, "codeBy", e.target.value)} placeholder="코드개발 (콤마 구분)" className={inputCls} />
                  <select value={d.badge ?? ""} onChange={(e) => setIntroField(k, "badge", e.target.value)} className={inputCls}>
                    {BADGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--ax-text-hint)]">아래 <b>[설정 저장]</b> 을 눌러야 반영됩니다.</p>
      </div>

      {/* LLM 서버 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">LLM 서버 (OpenAI 호환)</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">폐쇄망 내부 LLM 서버 주소입니다. 비워두면 서버 환경변수(.env)를 사용합니다.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">서버 주소 (base URL)</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8080/v1" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">API 키 {loaded?.hasApiKey && <span className="text-[var(--ax-success)]">· 설정됨</span>}</span>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder={loaded?.hasApiKey ? "변경 시에만 입력" : "비워두면 기본값(ollama)"} className={inputCls} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={loadModels} disabled={loadingModels} className={btnGhost}>
            {loadingModels ? "불러오는 중…" : "모델 불러오기"}
          </button>
          {modelsMsg && <span className={`text-xs ${modelsMsg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{modelsMsg.text}</span>}
        </div>

        <datalist id="llm-models">
          {models.map((m) => <option key={m} value={m} />)}
        </datalist>

        <div className="mt-4 border-t border-[var(--ax-border-soft)] pt-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ax-text-muted)]">기본 모델 (기능별 미지정 시 사용)</span>
            <div className="flex flex-wrap items-center gap-2">
              <input list="llm-models" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="모델 ID 입력 또는 선택" className={`${inputCls} min-w-[16rem] flex-1`} />
              <button onClick={() => runTest("default", defaultModel)} disabled={test.default?.busy} className={btnGhost}>
                {test.default?.busy ? "테스트 중…" : "설정 테스트"}
              </button>
            </div>
          </label>
          {test.default?.text && (
            <div className={`mt-1.5 text-xs ${test.default.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>
              {test.default.ok ? "✓ " : "✗ "}{test.default.text}
            </div>
          )}
        </div>
      </div>

      {/* 기능별 모델 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">기능별 LLM 모델</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">각 AI 기능(API)이 사용할 모델을 지정합니다. 비워두면 위의 <b>기본 모델</b>을 사용합니다.</p>
        <div className="space-y-2">
          {LLM_FEATURES.map((f) => {
            const v = featureModels[f.key] ?? "";
            const ts = test[f.key];
            return (
              <div key={f.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--ax-border-soft)] bg-[var(--ax-surface-soft,#fafafa)] px-3 py-2">
                <span className="w-32 flex-none text-sm font-semibold text-[var(--ax-text)]">{f.label}</span>
                <input list="llm-models" value={v} onChange={(e) => setFM(f.key, e.target.value)} placeholder="기본 모델 사용" className={`${inputCls} min-w-[12rem] flex-1`} />
                <button onClick={() => runTest(f.key, v || defaultModel)} disabled={ts?.busy} className={btnGhost}>
                  {ts?.busy ? "…" : "테스트"}
                </button>
                {ts?.text && (
                  <div className={`w-full text-xs ${ts.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>
                    {ts.ok ? "✓ " : "✗ "}{ts.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* AI 지식검색 — 의미(임베딩)·그래프 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">AI 지식검색 — 의미·그래프</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          키워드 검색에 더해 <strong className="font-semibold">임베딩(의미) 검색</strong>과 <strong className="font-semibold">그래프(참조·위계) 확장</strong>을 사용합니다. 임베딩은 Ollama 임베딩 서버가 필요합니다(꺼져 있으면 자동으로 키워드만 사용).
        </p>
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2 text-sm text-[var(--ax-text-muted)]">
            <input type="checkbox" checked={vectorOn} onChange={(e) => setVectorOn(e.target.checked)} />
            임베딩(의미) 검색 사용
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--ax-text-muted)]">
            <input type="checkbox" checked={graphOn} onChange={(e) => setGraphOn(e.target.checked)} />
            그래프(참조·위계) 확장 사용
          </label>
          <div className="mt-2 border-t border-[var(--ax-border-soft)] pt-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-[var(--ax-text-muted)]">임베딩 서버 주소 (Ollama)</span>
              <input value={embedBaseUrl} onChange={(e) => setEmbedBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434 (비우면 기본)" className={inputCls} />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={loadEmbedModels} disabled={loadingEmbedModels} className={btnGhost}>
                {loadingEmbedModels ? "불러오는 중…" : "모델 불러오기"}
              </button>
              {embedModelsMsg && <span className={`text-xs ${embedModelsMsg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{embedModelsMsg.text}</span>}
            </div>
            <datalist id="embed-models">
              {embedModels.map((m) => <option key={m} value={m} />)}
            </datalist>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--ax-text-muted)]">임베딩 모델</span>
                <input list="embed-models" value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} placeholder="예: bge-m3 (비우면 기본)" className={`${inputCls} min-w-[16rem]`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--ax-text-muted)]">차원 <span className="font-normal text-[var(--ax-text-hint)]">0=기본</span></span>
                <input type="number" min={0} max={8192} value={embedDims} onChange={(e) => setEmbedDims(Number(e.target.value))} className={`${inputCls} w-24`} />
              </label>
              <button onClick={runEmbedTest} disabled={embedTest?.busy} className={btnGhost}>
                {embedTest?.busy ? "테스트 중…" : "임베딩 테스트"}
              </button>
              <button onClick={refreshRagCache} className={btnGhost}>RAG 캐시 새로고침</button>
            </div>
            {embedTest?.text && (
              <div className={`mt-1.5 text-xs ${embedTest.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>
                {embedTest.ok ? "✓ " : "✗ "}{embedTest.text}
              </div>
            )}
            {ragCacheMsg && <div className="mt-1.5 text-xs text-[var(--ax-text-muted)]">{ragCacheMsg}</div>}
            <p className="mt-2 text-xs text-[var(--ax-danger)]">
              ⚠ 임베딩 모델·차원을 바꾸면 저장된 벡터와 불일치해 의미검색이 동작하지 않습니다. 변경 후 벡터 재빌드가 필요합니다.
            </p>
            <p className="mt-1 text-xs text-[var(--ax-text-hint)]">
              🛟 배포서버에서 <code>update-rag-db</code>로 사규 DB(rag_*)만 교체한 뒤에는 <b>[RAG 캐시 새로고침]</b>을 누르면 <b>앱 재시작 없이</b> 새 DB가 반영됩니다.
            </p>
          </div>
        </div>
      </div>

      {/* 업로드 제한 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">업로드 제한</div>
        <p className="mb-2 text-xs text-[var(--ax-text-hint)]">
          라이브러리 등에서 허용하는 <strong className="font-semibold">개별 파일</strong> 최대 크기(MB). 실행파일 확장자는 항상 차단됩니다.
        </p>
        <p className="mb-3 rounded-lg bg-[var(--ax-border-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--ax-text-muted)]">
          영상 등록 시 영상과 썸네일이 <strong className="font-semibold">한 번의 요청</strong>으로 전송됩니다.
          서버 요청 본문 상한은 <strong className="font-semibold">{uploadLimits.proxyBodyMb}MB</strong>
          (next.config, 배포·재시작 시 반영)이며, 관리자에서 설정 가능한 이미지·파일 상한 합({uploadLimits.maxImageMb}+{uploadLimits.maxFileMb}MB)과 맞춰져 있습니다.
          썸네일은 이미지 한도, 영상·첨부는 파일 한도로 각각 검증됩니다.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--ax-text-muted)]">
            이미지(썸네일)
            <input type="number" min={1} max={uploadLimits.maxImageMb} value={imageMb} onChange={(e) => setImageMb(Number(e.target.value))} className={`${inputCls} w-24`} /> MB
            <span className="text-xs text-[var(--ax-text-hint)]">최대 {uploadLimits.maxImageMb}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--ax-text-muted)]">
            영상·첨부 파일
            <input type="number" min={1} max={uploadLimits.maxFileMb} value={fileMb} onChange={(e) => setFileMb(Number(e.target.value))} className={`${inputCls} w-24`} /> MB
            <span className="text-xs text-[var(--ax-text-hint)]">최대 {uploadLimits.maxFileMb}</span>
          </label>
        </div>
        {imageMb + fileMb > uploadLimits.proxyBodyMb && (
          <p className="mt-2 text-xs text-[var(--ax-danger)]">
            이미지·파일 한도 합({imageMb + fileMb}MB)이 서버 요청 본문 상한({uploadLimits.proxyBodyMb}MB)을 초과합니다. 영상+썸네일 동시 업로드가 실패할 수 있습니다.
          </p>
        )}
      </div>

      {/* 저장 */}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "저장 중…" : "설정 저장"}</button>
        {saveMsg && <span className={`text-sm ${saveMsg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{saveMsg.text}</span>}
      </div>

      {/* 관리자 암호 변경 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">관리자 암호 변경</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          현재 암호 확인 후 변경됩니다. 변경된 암호는 DB에 안전하게(scrypt 해시) 저장되어 환경변수보다 우선합니다.
          {loaded ? (loaded.hasAdminKey ? " 현재 DB 암호가 설정되어 있습니다." : " 현재는 환경변수(.env) 암호를 사용 중입니다.") : ""}
        </p>
        <div className="grid max-w-md gap-2">
          <input value={oldKey} onChange={(e) => setOldKey(e.target.value)} type="password" placeholder="현재 암호" className={inputCls} />
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} type="password" placeholder="새 암호 (8자 이상)" className={inputCls} />
          <input value={newKey2} onChange={(e) => setNewKey2(e.target.value)} type="password" placeholder="새 암호 확인" className={inputCls} />
          <div className="flex items-center gap-3">
            <button onClick={changeKey} disabled={keyBusy} className={btnPrimary}>{keyBusy ? "변경 중…" : "암호 변경"}</button>
            {keyMsg && <span className={`text-sm ${keyMsg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{keyMsg.text}</span>}
          </div>
        </div>
      </div>

      {/* 관리자 접속 IP 제한 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">관리자 접속 IP 제한</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          허용할 IP를 콤마로 구분해 입력하세요(단일 IP 또는 IPv4 CIDR — 예: <code>10.0.0.5, 10.0.1.0/24</code>).
          비우면 IP 제한 없음(암호만).
          <br />🛟 <b>서비스 구동 머신(localhost)에서는 어떤 경우에도 접속 가능</b>하고, 환경변수 <code>ADMIN_ALLOWED_IPS</code>도 항상 허용됩니다 → <b>완전 잠금은 없습니다</b>(박스에서 복구 가능).
          <br />⚠ 다만 원격에서 잘못 등록하면 원격 접속이 막힐 수 있으니 현재 접속 IP를 먼저 확인하세요. 리버스프록시 뒤에서는 x-forwarded-for가 신뢰 설정돼야 정확합니다.
        </p>
        <div className="grid max-w-2xl gap-2">
          <textarea value={adminIps} onChange={(e) => setAdminIps(e.target.value)} rows={2} placeholder="예: 10.0.0.5, 10.0.1.0/24 (비우면 제한 없음)" className={inputCls} />
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className={btnPrimary}>{saving ? "저장 중…" : "IP 설정 저장"}</button>
            {saveMsg && <span className={`text-sm ${saveMsg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{saveMsg.text}</span>}
          </div>
        </div>
      </div>

      {/* 안전 게시판 비밀번호 */}
      <div className={cardCls}>
        <div className="mb-1 text-sm font-bold text-[var(--ax-text)]">안전 게시판 관리 비밀번호</div>
        <p className="mb-3 text-xs text-[var(--ax-text-hint)]">
          스마트 안전관리 패널의 <b>뉴스·자료 등록·수정·삭제</b>에 필요한 비밀번호입니다. 이 비밀번호를 아는 담당자만 게시물을 관리할 수 있습니다(관리자는 로그인만으로 가능).
          {loaded ? (loaded.hasSafetyPw ? " 현재 비밀번호가 설정되어 있습니다." : " 현재 미설정 — 관리자만 관리 가능합니다.") : ""}
        </p>
        <div className="grid max-w-md gap-2">
          <input value={safetyPw} onChange={(e) => setSafetyPw(e.target.value)} type="password" placeholder="새 비밀번호 (4자 이상)" className={inputCls} />
          <input value={safetyPw2} onChange={(e) => setSafetyPw2(e.target.value)} type="password" placeholder="비밀번호 확인" className={inputCls} />
          <div className="flex items-center gap-3">
            <button onClick={() => saveSafetyPw(false)} disabled={safetyBusy} className={btnPrimary}>{safetyBusy ? "저장 중…" : "비밀번호 설정"}</button>
            {loaded?.hasSafetyPw && <button onClick={() => saveSafetyPw(true)} disabled={safetyBusy} className={btnGhost}>해제</button>}
            {safetyMsg && <span className={`text-sm ${safetyMsg.ok ? "text-[var(--ax-success)]" : "text-[var(--ax-danger)]"}`}>{safetyMsg.text}</span>}
          </div>
        </div>
      </div>

      {/* 배포·재시작 */}
      <ServerOpsCard />

      {/* 세션 */}
      <div className={cardCls}>
        <div className="mb-2 text-sm font-bold text-[var(--ax-text)]">세션</div>
        <button onClick={logout} className={btnGhost}>관리자 로그아웃</button>
      </div>
    </div>
  );
}
