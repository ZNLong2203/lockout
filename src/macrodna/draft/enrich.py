"""Build ``draft_enriched.parquet``: every draft action with its series, side, role and result.

One row per ban or pick. Joins the cache with the (licensed) metadata tables, so the output is derived
data and stays in the gitignored cache.

Facts established on the corpus and relied on here:
* All 569 multi-game series are **Fearless**: no champion is picked twice within a series.
* 99.8 % of picks match the champion a player of that team actually played (``rosters.csv``), so a pick can
  be tied to a player and, through the inferred role, to a lane.
* Draft order: bans 1-6, picks 7-12, bans 13-16, picks 17-20 (sequence numbers).
"""

from __future__ import annotations

from pathlib import Path

import duckdb

PHASES_SQL = """case when d.seq <= 6 then 'ban1' when d.seq <= 12 then 'pick1'
                      when d.seq <= 16 then 'ban2' else 'pick2' end"""

ENRICH_SQL = f"""
with g as (
  select g.game_id, g.series_id, g.game_number, g.blue_team_id, g.red_team_id, g.winner_team_id,
         m.patch, m.started_at, s.event
  from read_parquet('{{cache}}/games.parquet') g
  join read_csv('{{meta}}/games.csv', all_varchar = true) m on m.game_id = g.game_id and m.title = 'lol'
  join read_csv('{{lol}}/series.csv', all_varchar = true) s on s.series_id = g.series_id
),
series_len as (
  select series_id, max(game_number) as series_games from read_parquet('{{cache}}/games.parquet') group by 1
),
pick_player as (
  select r.game_id, r.team_id, r.character_name, any_value(r.player_id) as player_id
  from read_csv('{{meta}}/rosters.csv', all_varchar = true) r where r.title = 'lol'
  group by 1, 2, 3
),
role_of as (
  select p.game_id, p.player_id, any_value(ro.role) as role
  from read_parquet('{{cache}}/players.parquet') p
  join read_parquet('{{cache}}/roles.parquet') ro on ro.game_id = p.game_id and ro.slot = p.slot
  group by 1, 2
)
select d.game_id, g.series_id, g.game_number, sl.series_games, g.event, split_part(g.event, ' - ', 1) as league,
       g.patch, g.started_at, d.team_id,
       case when d.team_id = g.blue_team_id then 'blue' else 'red' end as side,
       d.action, d.seq::int as seq, {PHASES_SQL} as phase,
       d.character as champion, pp.player_id, ro.role,
       (d.team_id = g.winner_team_id) as won
from read_parquet('{{cache}}/draft.parquet') d
join g on g.game_id = d.game_id
join series_len sl on sl.series_id = g.series_id
left join pick_player pp on d.action = 'pick' and pp.game_id = d.game_id and pp.team_id = d.team_id
     and pp.character_name = d.character
left join role_of ro on ro.game_id = d.game_id and ro.player_id = pp.player_id
order by g.started_at, d.game_id, d.seq
"""


def build_draft_table(
    cache_lol_dir: Path, meta_dir: Path, lol_dir: Path, out: Path | None = None
) -> int:
    """Write the enriched draft table and return its row count."""
    con = duckdb.connect()
    sql = ENRICH_SQL.format(cache=cache_lol_dir, meta=meta_dir, lol=lol_dir)
    target = out or cache_lol_dir / "draft_enriched.parquet"
    con.execute(f"copy ({sql}) to '{target}' (format parquet, compression zstd)")
    return int(con.sql(f"select count(*) from read_parquet('{target}')").fetchall()[0][0])
