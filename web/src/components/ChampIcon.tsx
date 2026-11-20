import { iconUrl, useCatalog } from "../lib/ddragon";

export type ChampState = "locked" | "banned" | "used" | undefined;

interface Props {
  name: string | null;
  size?: number;
  state?: ChampState;
  mark?: "ours" | "theirs" | "both";
  onClick?: () => void;
  caption?: string;
}

const LOCK = (
  <svg viewBox="0 0 16 16" aria-hidden className="champ-badge">
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const STATE_TEXT: Record<Exclude<ChampState, undefined>, string> = {
  locked: "locked (picked earlier in the series)",
  banned: "banned in this draft",
  used: "already picked in this draft",
};

export function ChampIcon({ name, size = 40, state, mark, onClick, caption }: Props) {
  const catalog = useCatalog();
  if (!name) return <span className="champ empty" style={{ width: size, height: size }} aria-label="empty slot" />;
  const src = iconUrl(catalog, name);
  const label = state ? `${name}, ${STATE_TEXT[state]}` : name;
  const body = (
    <>
      <span className={`champ ${state ?? ""}`} style={{ width: size, height: size }}>
        {src ? <img src={src} alt="" width={size} height={size} loading="lazy" /> : <span className="champ-fallback">{name.slice(0, 2)}</span>}
        {state === "locked" && LOCK}
        {state === "banned" && <span className="champ-slash" aria-hidden />}
        {mark && <span className={`champ-mark ${mark}`} aria-hidden />}
      </span>
      {caption && <span className="champ-caption">{caption}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="champ-btn" title={label} aria-label={label} onClick={onClick} disabled={state === "locked" || state === "used"}>
      {body}
    </button>
  ) : (
    <span className="champ-wrap" title={label} aria-label={label} role="img">
      {body}
    </span>
  );
}

export const ROLE_SHORT: Record<string, string> = { top: "TOP", jungle: "JGL", mid: "MID", adc: "BOT", support: "SUP", unknown: "?" };
