// Small-sample statistics for pass rates. Eval splits hold tens of cases, so
// intervals and tests are exact or score-based, never normal approximations.

export type Rate = { passed: number; cases: number; rate: number; low: number; high: number };

// The Wilson score interval: 95% by default. No cases gives [0, 1].
export function wilson(passed: number, cases: number, z = 1.96): Rate {
  if (cases === 0) return { passed, cases, rate: 0, low: 0, high: 1 };
  const p = passed / cases;
  const z2 = z * z;
  const denominator = 1 + z2 / cases;
  const center = (p + z2 / (2 * cases)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / cases + z2 / (4 * cases * cases))) / denominator;
  return {
    passed,
    cases,
    rate: p,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

// The exact one-sided sign test on paired cases (McNemar's test): the chance
// of at least `fixed` of the `fixed + broken` cases that changed outcome
// changing for the better, if a change were a coin flip.
export function signTest(fixed: number, broken: number): number {
  const n = fixed + broken;
  if (n === 0) return 1;
  // Binomial(n, 1/2) probabilities, built up in log space so large n can't underflow.
  let log = -n * Math.LN2;
  let tail = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) log += Math.log((n - k + 1) / k);
    if (k >= fixed) tail += Math.exp(log);
  }
  return Math.min(1, tail);
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;

export const formatRate = (r: Rate) =>
  `${r.passed}/${r.cases} ${percent(r.rate)} [${percent(r.low)}, ${percent(r.high)}]`;
