export function DataTable(props: {
  columns: Array<{ key: string; label: string; align?: "left" | "center" | "right"; widthClass?: string }>;
  rows: Array<Record<string, React.ReactNode>>;
  emptyText?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {props.columns.map((c) => (
              <th
                key={c.key}
                className={[
                  "px-6 py-3 text-xs font-semibold text-gray-500",
                  c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : "text-left",
                  c.widthClass ?? "",
                ].join(" ")}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length ? (
            props.rows.map((r, idx) => (
              <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                {props.columns.map((c) => (
                  <td
                    key={c.key}
                    className={[
                      "px-6 py-4 text-sm",
                      c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : "text-left",
                    ].join(" ")}
                  >
                    {r[c.key] ?? "-"}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-6 py-8 text-sm text-gray-500" colSpan={props.columns.length}>
                {props.emptyText ?? "데이터가 없습니다."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

