import { motion } from "framer-motion";
import { ArrowRight, PlayCircle, Radar, Swords } from "lucide-react";
import { Suspense, lazy } from "react";
import type { TeamSummary } from "../api/types";
import { useCatalog } from "../lib/ddragon";
import { draftLink, teamLink } from "../lib/route";
import { TeamBadge, TeamSearch, leagueOf } from "./TeamSearch";

const Rift3D = lazy(() => import("./Rift3D"));

const TILES = [
  { icon: Swords, title: "Draft room", text: "Plan a Fearless series pick by pick.", href: draftLink() },
  { icon: Radar, title: "Scout a team", text: "What they ban, lean on, and how they play the map.", href: teamLink() },
  { icon: PlayCircle, title: "Replay", text: "Watch any pro game on a 3D Rift.", href: "#/replay" },
];

export function Home({ teams, ours }: { teams: TeamSummary[]; ours: string | null }) {
  const catalog = useCatalog();
  const popular = [...teams].sort((a, b) => Number(/cloud9/i.test(b.name)) - Number(/cloud9/i.test(a.name)) || b.games - a.games).slice(0, 6);
  const leagues = new Set(teams.map(leagueOf));
  const games = Math.round(teams.reduce((s, t) => s + t.games, 0) / 2);

  return (
    <main className="home">
      <section className="home-hero">
        <div className="home-3d" aria-hidden>
          <Suspense fallback={null}>
            <Rift3D catalog={catalog} ambient labels={false} className="home-rift" />
          </Suspense>
        </div>
        <motion.div className="home-content" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <span className="eyebrow">Fearless draft intelligence · League of Legends</span>
          <h1>
            Know their draft
            <br />
            before they do.
          </h1>
          <p className="home-lede">Search the team you play next.</p>
          <TeamSearch teams={teams} size="lg" autoFocus placeholder="Search a team, e.g. Cloud9" onSelect={(t) => (window.location.hash = teamLink(t.team_id))} />
          <div className="popular" aria-label="Popular teams">
            {popular.map((t) => (
              <a key={t.team_id} className="popular-chip" href={teamLink(t.team_id)}>
                <TeamBadge team={t} size={22} />
                {t.name}
              </a>
            ))}
          </div>
          <div className="home-actions">
            <a className="btn primary" href={draftLink(ours)}>
              Open the draft room <ArrowRight size={16} aria-hidden />
            </a>
            <span className="kbd-hint">
              or press <kbd>⌘</kbd>
              <kbd>K</kbd> anywhere
            </span>
          </div>
        </motion.div>
      </section>

      <section className="app home-tiles">
        {TILES.map(({ icon: Icon, title, text, href }, i) => (
          <motion.a
            key={title}
            href={href}
            className="tile-link"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
          >
            <Icon size={26} aria-hidden />
            <b>{title}</b>
            <span>{text}</span>
          </motion.a>
        ))}
      </section>

      <section className="app home-stats" aria-label="Coverage">
        <div>
          <b>{games.toLocaleString()}</b>
          <span>pro games</span>
        </div>
        <div>
          <b>{teams.length}</b>
          <span>teams</span>
        </div>
        <div>
          <b>{leagues.size}</b>
          <span>leagues</span>
        </div>
        <div>
          <b>1 Hz</b>
          <span>player positions</span>
        </div>
      </section>
    </main>
  );
}
