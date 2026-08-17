export function FilterBar(props: {
  items: Array<{ label: string; node: React.ReactNode }>;
  primaryAction?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap gap-3 items-center">
        {props.items.map((x, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="text-xs font-semibold text-gray-500">{x.label}</div>
            {x.node}
          </div>
        ))}
      </div>
      {props.primaryAction ? <div className="flex justify-end">{props.primaryAction}</div> : null}
    </div>
  );
}

