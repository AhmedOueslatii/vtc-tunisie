'use client';

import { type KeyboardEvent, useState } from 'react';
import { labelIndices } from '@/lib/chart';

export interface BarPoint {
  key: string;
  /** Étiquette courte de l'axe (« 1 oct. ») */
  label: string;
  /** Titre de l'infobulle (« 1 octobre 2026 ») */
  title: string;
  value: number;
  valueLabel: string;
  /** Lignes de l'infobulle ; la première porte la série tracée. */
  rows: { label: string; value: string }[];
}

interface Props {
  title: string;
  points: BarPoint[];
  yMax: number;
  yTicks: { value: number; label: string }[];
  /** Texte de l'aide à la navigation clavier, lu par les lecteurs d'écran. */
  hint: string;
}

const W = 640;
const H = 220;
const M = { top: 22, right: 8, bottom: 26, left: 52 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** Colonne arrondie à l'extrémité de la donnée, carrée sur la ligne de base. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/**
 * Graphique en colonnes d'une seule série (le titre la nomme : pas de légende). Grille en filets, une seule valeur
 * étiquetée (le maximum), le reste à l'infobulle — au survol comme au clavier (flèches, début, fin, Échap) —
 * et dans le tableau de données que la page affiche en dessous.
 */
export function BarChart({ title, points, yMax, yTicks, hint }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const band = PLOT_W / n;
  const barWidth = Math.max(1.5, Math.min(MAX_BAR, band - GAP));
  const y = (value: number) => M.top + PLOT_H - (value / yMax) * PLOT_H;
  const xCenter = (i: number) => M.left + band * i + band / 2;

  const maxIndex = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? 0) ? i : best), 0);
  const labelled = new Set(labelIndices(n));
  const current = active === null ? null : points[active];

  function onKeyDown(event: KeyboardEvent) {
    const move = (to: number) => {
      event.preventDefault();
      setActive(Math.max(0, Math.min(n - 1, to)));
    };
    if (event.key === 'ArrowRight') move((active ?? -1) + 1);
    else if (event.key === 'ArrowLeft') move((active ?? n) - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(n - 1);
    else if (event.key === 'Escape') setActive(null);
  }

  // Le sens de lecture du temps reste de gauche à droite, même dans l'interface arabe
  const frac = active === null ? 0 : xCenter(active) / W;
  const tooltipShift = frac < 0.25 ? '0%' : frac > 0.75 ? '-100%' : '-50%';

  return (
    <div dir="ltr" className="relative overflow-x-auto">
      <div className="relative min-w-[480px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          role="group"
          aria-label={title}
          aria-describedby={`${title}-hint`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {yTicks.map((tick) => (
            <g key={tick.value}>
              <line x1={M.left} x2={W - M.right} y1={y(tick.value)} y2={y(tick.value)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 8} y={y(tick.value) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
                {tick.label}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const height = (p.value / yMax) * PLOT_H;
            return (
              <g key={p.key}>
                {p.value > 0 && (
                  <path
                    d={barPath(xCenter(i) - barWidth / 2, y(p.value), barWidth, height)}
                    fill={active === i ? 'var(--series-1-hover)' : 'var(--series-1)'}
                  />
                )}
                {labelled.has(i) && (
                  <text x={xCenter(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                    {p.label}
                  </text>
                )}
                {/* Zone de survol : la colonne entière, bien plus large que la barre */}
                <rect
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerMove={() => setActive(i)}
                />
              </g>
            );
          })}

          {points[maxIndex] && points[maxIndex].value > 0 && (
            <text
              x={Math.min(Math.max(xCenter(maxIndex), M.left + 14), W - M.right - 14)}
              y={y(points[maxIndex].value) - 6}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--fg)"
            >
              {points[maxIndex].valueLabel}
            </text>
          )}
        </svg>

        <p id={`${title}-hint`} className="sr-only">
          {hint}
        </p>
        <p className="sr-only" aria-live="polite">
          {current ? `${current.title} : ${current.rows.map((r) => `${r.label} ${r.value}`).join(', ')}` : ''}
        </p>

        {current && (
          <div
            role="presentation"
            className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-md border border-line bg-card px-3 py-2 text-xs shadow-md"
            style={{ left: `${frac * 100}%`, transform: `translateX(${tooltipShift})` }}
          >
            <p className="text-muted">{current.title}</p>
            {current.rows.map((row, i) => (
              <p key={row.label} className="mt-1 flex items-center gap-2">
                {i === 0 ? (
                  <span aria-hidden className="h-0.5 w-3 shrink-0 rounded" style={{ background: 'var(--series-1)' }} />
                ) : (
                  <span aria-hidden className="w-3 shrink-0" />
                )}
                <span className="text-muted">{row.label}</span>
                <span className="ms-auto ps-3 font-semibold text-fg">{row.value}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
