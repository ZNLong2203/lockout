import { Command } from "cmdk";
import { Home, PlayCircle, Radar, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import type { TeamSummary } from "../api/types";
import { draftLink, teamLink } from "../lib/route";
import { TeamBadge, leagueOf } from "./TeamSearch";

/** ⌘K / Ctrl+K (or "/") from anywhere: jump to a team, or start a draft against it. */
export function CommandPalette({ teams, ours }: { teams: TeamSummary[]; ours: string | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("lockout:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lockout:search", onOpen);
    };
  }, []);
  const go = (href: string) => {
    window.location.hash = href;
    setOpen(false);
  };
  const byGames = [...teams].sort((a, b) => b.games - a.games);
  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Search" className="cmdk">
      <Command.Input placeholder="Search a team, or type a page…" />
      <Command.List>
        <Command.Empty>No match.</Command.Empty>
        <Command.Group heading="Teams">
          {byGames.map((t) => (
            <Command.Item key={t.team_id} value={`${t.name} ${leagueOf(t)}`} onSelect={() => go(teamLink(t.team_id))}>
              <TeamBadge team={t} size={24} />
              <span>{t.name}</span>
              <span className="cmdk-meta">{leagueOf(t)}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Draft against">
          {byGames
            .filter((t) => t.team_id !== ours)
            .map((t) => (
              <Command.Item key={`d-${t.team_id}`} value={`draft vs ${t.name}`} onSelect={() => go(draftLink(ours, t.team_id))}>
                <Swords size={16} aria-hidden />
                <span>Draft vs {t.name}</span>
              </Command.Item>
            ))}
        </Command.Group>
        <Command.Group heading="Pages">
          <Command.Item value="home" onSelect={() => go("#/")}>
            <Home size={16} aria-hidden /> Home
          </Command.Item>
          <Command.Item value="draft room" onSelect={() => go(draftLink())}>
            <Swords size={16} aria-hidden /> Draft room
          </Command.Item>
          <Command.Item value="teams scouting" onSelect={() => go(teamLink())}>
            <Radar size={16} aria-hidden /> Teams
          </Command.Item>
          <Command.Item value="replay" onSelect={() => go("#/replay")}>
            <PlayCircle size={16} aria-hidden /> Replay
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
