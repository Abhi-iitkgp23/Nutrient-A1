import { CookieSticker, TeacupSticker } from "./stickers";

export type PanelSource = {
  title: string;
  locator: string;
} | null;

export type PanelClaim = {
  text: string;
  source: PanelSource;
};

export function SourcesPanel({ claims }: { claims: PanelClaim[] | null }) {
  const empty = claims == null || claims.length === 0;

  return (
    <aside className="flex min-h-64 flex-col bg-butter p-4 md:min-h-0 md:w-[380px] md:shrink-0 md:overflow-y-auto md:border-l md:border-blush/60 md:p-6 lg:w-[420px]">
      <div className="mb-4 flex shrink-0 items-center justify-between border-b-2 border-yellow/60 pb-3 md:mb-6 md:pb-4">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center rounded-xl border border-yellow bg-white p-1.5">
            <TeacupSticker />
          </span>
          <h2 className="text-lg font-extrabold tracking-tight text-cocoa md:text-xl">Sources</h2>
        </div>
        <span className="rounded-full border border-yellow bg-cream px-2.5 py-1 text-[10px] font-bold text-dusty md:text-xs">
          Bound to selected
        </span>
      </div>
      {empty ? (
        <div className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-blush bg-cream p-4">
          <span className="shrink-0 rounded-xl border border-yellow bg-butter p-1.5">
            <CookieSticker />
          </span>
          <p className="text-sm font-extrabold text-cocoa">No claims in this answer</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3 md:gap-5">
          {claims.map((claim, index) => (
            <li
              key={`${index}-${claim.text}`}
              className="space-y-3 rounded-3xl border-2 border-blush bg-white p-4 shadow-[0_4px_12px_rgba(92,58,69,0.04)] md:p-5"
            >
              <div>
                <span className="mb-1 block text-[11px] font-extrabold tracking-wider text-dusty uppercase">
                  Claim {index + 1}
                </span>
                <p className="text-sm font-bold text-cocoa md:text-base">{claim.text}</p>
              </div>
              <SourceSlot source={claim.source} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SourceSlot({ source }: { source: PanelSource }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-yellow bg-butter px-4 py-2.5">
      <span className="text-xs font-extrabold tracking-wide text-dusty uppercase">Source</span>
      {source ? (
        <span className="text-right text-sm font-extrabold text-cocoa">
          <span className="block">{source.title}</span>
          <span className="block font-semibold">{source.locator}</span>
        </span>
      ) : (
        <span className="text-sm font-extrabold text-cocoa">No source</span>
      )}
    </div>
  );
}
