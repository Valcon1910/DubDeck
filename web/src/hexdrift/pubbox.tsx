// The publish box every map editor shows: the difficulty rating, what's still
// missing, and the button. A map needs a name of its own and a rating to go out.
import { publishNeeds, RATINGS, versionOf, type CustomMap, type Rating } from "./sim/custom.ts";

export function PublishBox({ map, signedIn, author, problems, pub, publishing, onRate, onPublish }: {
  map: CustomMap; signedIn: boolean; author: boolean; problems: number;
  pub: { id: string; version: string } | null; publishing: boolean;
  onRate: (r: Rating) => void; onPublish: () => void;
}) {
  const need = publishNeeds(map);
  const why = !signedIn ? "Sign in to Chat to publish." : !author ? "Drive it to the finish first: your time sets the medals." : problems ? "Fix the problems first." : need ? `${need}.` : "";
  return (
    <div className="hx-ed-pub">
      <div className="hx-ed-row">
        <span className="hx-dim">Difficulty</span>
        <div className="hx-ed-chips" role="radiogroup" aria-label="Difficulty">
          {RATINGS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={map.rating === r} className={`hx-chip-btn ${map.rating === r ? "on" : ""}`} onClick={() => onRate(r)}>{r}</button>
          ))}
        </div>
      </div>
      {pub && <a href={`#/hexdrift/c/${pub.id}`}>{pub.version === versionOf(map) ? "Published" : "Published (an older version)"}</a>}
      <button type="button" className="hx-btn" disabled={!!why || publishing || (!!pub && pub.version === versionOf(map))} onClick={onPublish} title={why}>
        {publishing ? "Checking your run…" : pub ? "Update in Community Maps" : "Publish to Community Maps"}
      </button>
      {why && <span className="hx-dim hx-small">{why}</span>}
    </div>
  );
}
