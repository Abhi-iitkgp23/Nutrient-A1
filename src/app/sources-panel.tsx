export type PanelSource = {
  title: string;
  locator: string;
} | null;

export type PanelClaim = {
  text: string;
  source: PanelSource;
};

export function SourcesPanel({ claims }: { claims: PanelClaim[] | null }) {
  return (
    <aside className="flex max-h-[40vh] min-h-48 flex-col border-t border-stone-200 bg-stone-100 md:max-h-dvh md:w-80 md:shrink-0 md:border-t-0 md:border-l">
      <h2 className="px-4 pt-4 text-sm font-semibold tracking-wide text-stone-700">Sources</h2>
      {claims == null || claims.length === 0 ? (
        <p className="px-4 py-3 text-sm text-stone-600">No claims in this answer</p>
      ) : (
        <ul className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
          {claims.map((claim, index) => (
            <li key={`${index}-${claim.text}`} className="rounded-lg bg-white p-3 text-sm text-stone-800">
              <p>{claim.text}</p>
              <SourceSlot source={claim.source} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SourceSlot({ source }: { source: PanelSource }) {
  if (!source) {
    return <p className="mt-2 text-stone-500">No source</p>;
  }
  return (
    <p className="mt-2 text-stone-600">
      <span className="block">{source.title}</span>
      <span className="block">{source.locator}</span>
    </p>
  );
}
