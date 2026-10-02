export interface Scale {
  max: number;
  ticks: number[];
}

/**
 * Échelle verticale « propre » (0, 5, 10, 15…) : le sommet est un multiple du pas, jamais en dessous du maximum.
 * `integer` impose un pas entier (comptages de courses : pas de graduation à 2,5).
 */
export function niceScale(rawMax: number, targetTicks = 4, integer = false): Scale {
  const max = rawMax > 0 ? rawMax : 1;
  const rough = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const f = rough / magnitude;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * magnitude;
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return { max: top, ticks };
}

/** Indices des étiquettes de l'axe horizontal (≈ `target`), alignés sur le dernier point pour que « aujourd'hui » soit toujours nommé. */
export function labelIndices(count: number, target = 6): number[] {
  if (count <= target + 1) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / target);
  return Array.from({ length: count }, (_, i) => i).filter((i) => (count - 1 - i) % step === 0);
}
