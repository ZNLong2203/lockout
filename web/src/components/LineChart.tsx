import { useEffect, useRef, useState } from "react";

export interface Series {
  id: string;
  label: string;
  color: string; // a CSS colour, normally var(--series-N)
  values: (number | null)[];
}

interface Props {
  title: string;
  subtitle?: string;
  xLabels: string[];
  series: Series[];
  yMax?: number;
  format?: (v: number) => string;
  ariaLabel: string;
}

const H = 280;
const M = { l: 48, t: 16, b: 40 };
const CHAR_W = 6.6; // average glyph width at 12px, used to measure direct labels before placing them

// Round tick values: the smallest of these steps that gives at most five intervals.
function niceTicks(yMax: number): number[] {
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => yMax / s <= 5.01) ?? yMax / 4;
  const out: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) out.push(Number(v.toFixed(4)));
  return out;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Marks follow the dataviz specs: 2px lines, 8px markers with a 2px surface ring, hairline solid grid,
// a legend for two or more series, direct labels only where they do not collide, and a table view.
export function LineChart({ title, subtitle, xLabels, series, yMax = 1, format = pct, ariaLabel }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setW(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const n = xLabels.length;
  const y = (v: number) => M.t + (1 - Math.min(v / yMax, 1)) * (H - M.t - M.b);
  const ticks = niceTicks(yMax);

  const lastIdx = (s: Series) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return i;
    return -1;
  };
  const ends = series.map((s) => ({ s, i: lastIdx(s) })).filter((e) => e.i >= 0);
  const labelsFit = ends.every((a, ai) => ends.every((b, bi) => ai === bi || Math.abs(y(a.s.values[a.i] as number) - y(b.s.values[b.i] as number)) >= 18));

  // Direct labels only when there are several series, they do not collide and they fit without clipping.
  const labelW = Math.ceil(Math.max(0, ...series.map((sr) => sr.label.length)) * CHAR_W) + 34;
  const canLabel = series.length >= 2 && labelsFit && W - M.l - labelW >= 240;
  const mr = canLabel ? labelW : 28;
  const x = (i: number) => (n <= 1 ? (M.l + W - mr) / 2 : M.l + (i / (n - 1)) * (W - M.l - mr));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min((a ?? -1) + 1, n - 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max((a ?? n) - 1, 0));
    else if (e.key === "Escape") setActive(null);
  };

  const path = (s: Series) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const tipTop = active === null ? 0 : Math.min(...series.map((s) => (s.values[active] === null ? H : y(s.values[active] as number))));

  return (
    <section className="card" aria-label={ariaLabel}>
      <div className="top" style={{ marginBottom: 4 }}>
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="sub">{subtitle}</p>}
        </div>
        <button className="ghost" type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.id} style={{ ["--c" as string]: s.color }}>
              <i /> {s.label}
            </span>
          ))}
        </div>
      )}
      {asTable ? (
        <table>
          <thead>
            <tr>
              <th>Game</th>
              {series.map((s) => (
                <th key={s.id}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xLabels.map((l, i) => (
              <tr key={l}>
                <td>{l}</td>
                {series.map((s) => (
                  <td className="num" key={s.id}>
                    {s.values[i] === null ? "–" : format(s.values[i] as number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart" ref={wrapRef}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onMouseMove={onMove}
            onMouseLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.l} x2={W - mr} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
                  {format(t)}
                </text>
              </g>
            ))}
            {xLabels.map((l, i) => (
              <text key={l} x={x(i)} y={H - M.b + 18} textAnchor="middle" fontSize={11} fill="var(--muted)">
                {l}
              </text>
            ))}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={M.t} y2={H - M.b} stroke="var(--axis)" strokeWidth={1} />}
            {series.length === 1 && series[0] && (
              <path d={`${path(series[0])} L${x(lastIdx(series[0])).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`} fill={series[0].color} opacity={0.1} />
            )}
            {series.map((s) => (
              <g key={s.id}>
                <path d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {s.values.map((v, i) =>
                  v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />,
                )}
              </g>
            ))}
            {canLabel &&
              ends.map(({ s, i }) => (
                <g key={s.id}>
                  <circle cx={x(i) + 14} cy={y(s.values[i] as number)} r={4} fill={s.color} />
                  <text x={x(i) + 24} y={y(s.values[i] as number) + 4} fontSize={12} fill="var(--ink-2)">
                    {s.label}
                  </text>
                </g>
              ))}
          </svg>
          {active !== null && (
            <div className="tip" style={{ left: `${(x(active) / W) * 100}%`, top: `${(tipTop / H) * 100}%` }}>
              <div className="muted">{xLabels[active]}</div>
              {series.map((s) => (
                <div key={s.id}>
                  {s.label}: <b>{s.values[active] === null ? "–" : format(s.values[active] as number)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
