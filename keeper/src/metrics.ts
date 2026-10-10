/** In-memory counters behind GET /metrics and the latency figure in GET /health. */
export class Metrics {
  fills = 0;
  expiries = 0;
  failures: Record<string, number> = {};
  skipped: Record<string, number> = {};
  lastFillLatencyMs: number | null = null;
  private latencyTotal = 0;
  private gasUsedTotal = 0n;
  private gasCostWeiTotal = 0n;

  recordFill(latencyMs: number, gasUsed: bigint, effectiveGasPrice: bigint): void {
    this.fills++;
    this.lastFillLatencyMs = latencyMs;
    this.latencyTotal += latencyMs;
    this.gasUsedTotal += gasUsed;
    this.gasCostWeiTotal += gasUsed * effectiveGasPrice;
  }

  fail(reason: string): void {
    this.failures[reason] = (this.failures[reason] ?? 0) + 1;
  }

  skip(reason: string): void {
    this.skipped[reason] = (this.skipped[reason] ?? 0) + 1;
  }

  /** `monUsdE18`: MON price (1e18-scaled) if known, to express gas cost in USD. */
  snapshot(monUsdE18?: bigint) {
    const avgCostWei = this.fills ? this.gasCostWeiTotal / BigInt(this.fills) : 0n;
    return {
      fills: this.fills,
      expiries: this.expiries,
      failuresByReason: this.failures,
      skippedByReason: this.skipped,
      avgLatencyMs: this.fills ? Math.round(this.latencyTotal / this.fills) : null,
      lastFillLatencyMs: this.lastFillLatencyMs,
      avgGasUsed: this.fills ? (this.gasUsedTotal / BigInt(this.fills)).toString() : null,
      avgGasCostMon: this.fills ? weiToDecimal(avgCostWei) : null,
      avgGasCostUsd:
        this.fills && monUsdE18 ? weiToDecimal((avgCostWei * monUsdE18) / 10n ** 18n) : null,
    };
  }
}

/** 18-decimal fixed point → decimal string, without float rounding. */
export function weiToDecimal(wei: bigint, dp = 6): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, dp);
  return `${whole}.${frac}`;
}
