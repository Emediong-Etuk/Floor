import { describe, expect, it } from 'vitest';
import { Metrics, weiToDecimal } from '../src/metrics.ts';
import { scaleGas } from '../src/chain.ts';

describe('metrics and gas helpers', () => {
  it('averages latency and gas cost (MON and USD)', () => {
    const m = new Metrics();
    m.recordFill(800, 300_000n, 102n * 10n ** 9n);
    m.recordFill(1_200, 300_000n, 102n * 10n ** 9n);
    const s = m.snapshot(25n * 10n ** 15n); // MON at $0.025
    expect(s.avgLatencyMs).toBe(1_000);
    expect(s.avgGasCostMon).toBe('0.030600'); // 300k gas × 102 gwei
    expect(s.avgGasCostUsd).toBe('0.000765');
  });

  it('formats wei exactly and pads gas by the multiplier, rounding up', () => {
    expect(weiToDecimal(1_234_567_890_000_000_000n)).toBe('1.234567');
    expect(scaleGas(100_000n, 1.15)).toBe(115_000n);
    expect(scaleGas(100_001n, 1.15)).toBe(115_002n);
  });
});
