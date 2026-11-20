# MacroDNA web app: the Fearless draft room

A series view (earlier games lock their champions), an interactive draft board, plain-language insights with a ban
shortlist, the opponent jungler on a stylised map drawn from our own geometry, comfort pools per player, and what
repeats in the opponent's recent drafts. Champion portraits come from Riot's Data Dragon at runtime (never stored
here); Riot's required notice is in the footer. No player photos or broadcast footage are used.

React + TypeScript (Vite). Runs on **synthetic demo data** by default, so it works without the licensed data or the API.

```bash
cd web
npm install
npm run dev                      # synthetic demo data, http://localhost:5173
VITE_API=live npm run dev        # talks to the API (`uv run macrodna serve`, proxied from /api)
npm run build                    # typecheck + production build
```

Types in `src/api/types.ts` mirror `src/macrodna/api/schemas.py`; the contract is `docs/api-contract.md`.
Charts are hand-written SVG following the data-viz specs (2 px lines, 8 px markers with a surface ring, a legend
for two or more series, a table view for every chart, light and dark themes).
