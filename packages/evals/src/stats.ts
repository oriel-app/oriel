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

// Passes out of runs: one case's runs in one arm of a comparison.
export type Tally = { passed: number; runs: number };

// log(n!), from a table: runs per case stay in the tens.
const logFactorials = [0];
function logFactorial(n: number): number {
  for (let i = logFactorials.length; i <= n; i++)
    logFactorials.push((logFactorials[i - 1] ?? 0) + Math.log(i));
  return logFactorials[n] ?? 0;
}
const logChoose = (n: number, k: number) => logFactorial(n) - logFactorial(k) - logFactorial(n - k);

// The exact test of a change across cases that each ran several times in
// both arms, stratified by case (the conditional test of a common odds ratio
// of 1). With no change, every run of a case is a draw of the same coin, so
// given how many of its runs passed in all, how many fell to the candidate is
// hypergeometric. The candidate's passes summed over cases then follow the
// convolution of those. Returns the one-sided chance of a sum at least as
// high ("better") or as low ("worse") as the one seen. With one run a case in
// each arm, "better" is the sign test.
export function stratifiedTest(
  cases: readonly { baseline: Tally; candidate: Tally }[],
  direction: "better" | "worse",
): number {
  let sums = new Map([[0, 1]]);
  let seen = 0;
  for (const { baseline, candidate } of cases) {
    const runs = baseline.runs + candidate.runs;
    const passed = baseline.passed + candidate.passed;
    seen += candidate.passed;
    const total = logChoose(runs, passed);
    const next = new Map<number, number>();
    const low = Math.max(0, passed - baseline.runs);
    const high = Math.min(candidate.runs, passed);
    for (let c = low; c <= high; c++) {
      const chance = Math.exp(
        logChoose(candidate.runs, c) + logChoose(baseline.runs, passed - c) - total,
      );
      for (const [sum, p] of sums) next.set(sum + c, (next.get(sum + c) ?? 0) + p * chance);
    }
    sums = next;
  }
  let tail = 0;
  for (const [sum, p] of sums) if (direction === "better" ? sum >= seen : sum <= seen) tail += p;
  return Math.min(1, tail);
}

// Newcombe's hybrid score interval for the difference of two pass rates
// (candidate minus baseline), from each arm's Wilson interval: its lower end,
// one-sided at `z` (1.645 for 95%). It treats runs as independent, which
// overstates the noise when both arms ran the same cases, so it errs towards
// "worse".
export function differenceLow(baseline: Tally, candidate: Tally, z = 1.645): number {
  const b = wilson(baseline.passed, baseline.runs, z);
  const c = wilson(candidate.passed, candidate.runs, z);
  return c.rate - b.rate - Math.sqrt((c.rate - c.low) ** 2 + (b.high - b.rate) ** 2);
}
