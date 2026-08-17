"use client";

/**
 * 분석 매장 입력 — 본부명·역명·매장명 자유 입력.
 * 매장 현황이 수시로 바뀌므로 고정 마스터(콤보박스) 대신 직접 입력 방식.
 */
export interface StoreInfo {
  name: string; // 매장명
  bonbu: string; // 본부명
  station: string; // 역명
}

interface Props {
  label: string;
  value: StoreInfo | null;
  onChange: (store: StoreInfo | null) => void;
  accent?: string; // CSS color var
}

export function StoreSelector({ label, value, onChange, accent = "var(--kb)" }: Props) {
  const v = value ?? { name: "", bonbu: "", station: "" };
  const update = (patch: Partial<StoreInfo>) => {
    const next = { ...v, ...patch };
    const any = next.name.trim() || next.bonbu.trim() || next.station.trim();
    onChange(any ? next : null);
  };

  const field = (key: keyof StoreInfo, placeholder: string) => (
    <input
      type="text"
      value={v[key]}
      placeholder={placeholder}
      onChange={(e) => update({ [key]: e.target.value })}
      className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none"
      style={{ borderColor: v[key].trim() ? accent : undefined }}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-gray-700">{label}</label>
      <div className="grid grid-cols-3 gap-1.5">
        {field("bonbu", "본부명")}
        {field("station", "역명")}
        {field("name", "매장명")}
      </div>
    </div>
  );
}
