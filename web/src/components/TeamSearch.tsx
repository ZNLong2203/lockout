import { Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TeamSummary } from "../api/types";
import { isDarkLogo, useLogo } from "../lib/logos";

export const leagueOf = (t: TeamSummary) => (t.events[t.events.length - 1] ?? "").split(" - ")[0] || "—";

const initials = (name: string) =>
  name
    .replace(/^team\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** A team's crest: its logo when Leaguepedia has one (loaded at runtime), else initials on a stable hue. */
export function TeamBadge({ team, size = 36 }: { team: Pick<TeamSummary, "team_id" | "name">; size?: number }) {
  const logo = useLogo(team.name);
  const [broken, setBroken] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  if (logo && broken !== logo) {
    const inner = Math.round(size * 0.78);
    return (
      <span className={`team-badge logo${dark ? " on-light" : ""}`} aria-hidden style={{ width: size, height: size }}>
        <img
          src={logo}
          alt=""
          width={inner}
          height={inner}
          crossOrigin="anonymous"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => setDark(isDarkLogo(e.currentTarget))}
          onError={() => setBroken(logo)}
        />
      </span>
    );
  }
  const h = hue(team.team_id);
  return (
    <span
      className="team-badge"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 70% 48%), hsl(${(h + 40) % 360} 75% 32%))`,
      }}
    >
      {initials(team.name)}
    </span>
  );
}

interface Props {
  teams: TeamSummary[];
  onSelect: (team: TeamSummary) => void;
  placeholder?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  /** Team ids to leave out (e.g. the other side of a matchup). */
  exclude?: string[];
}

/** Type-ahead team search: name or league, best matches first, keyboard friendly. */
export function TeamSearch({ teams, onSelect, placeholder = "Search a team…", size = "md", autoFocus, exclude = [] }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = teams.filter((t) => !exclude.includes(t.team_id));
    const scored = pool
      .map((t) => {
        const name = t.name.toLowerCase();
        const league = leagueOf(t).toLowerCase();
        const score = !needle ? 1 : name.startsWith(needle) ? 3 : name.includes(needle) ? 2 : league.includes(needle) ? 1 : 0;
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.t.games - a.t.games);
    return scored.slice(0, 8).map((x) => x.t);
  }, [q, teams, exclude]);

  const choose = (t: TeamSummary) => {
    onSelect(t);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active] as TeamSummary);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`team-search ${size}`}>
      <div className="team-search-box">
        <Search size={size === "lg" ? 22 : 18} aria-hidden />
        <input
          ref={input}
          value={q}
          autoFocus={autoFocus}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => q && setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
      </div>
      {open && results.length > 0 && (
        <ul className="team-search-list" id={listId} role="listbox">
          {results.map((t, i) => (
            <li key={t.team_id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(t)} onMouseEnter={() => setActive(i)}>
                <TeamBadge team={t} size={30} />
                <span className="ts-name">{t.name}</span>
                <span className="ts-meta">
                  {leagueOf(t)} · {t.games} games
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
