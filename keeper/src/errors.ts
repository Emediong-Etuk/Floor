import { BaseError, ContractFunctionRevertedError } from 'viem';

/**
 * What a failed simulate/send means for the keeper. Names are FloorOrders custom errors
 * (plus venue/adapter errors that bubble up).
 */
export type Outcome =
  | 'done' // someone else filled/cancelled it: drop it
  | 'not-triggered' // price moved back: try again later
  | 'expired' // hand to the expiry queue
  | 'unfillable' // owner moved tokens or cut allowance
  | 'liquidity' // venue can't meet minOut right now
  | 'stale' // oracle price too old (push feed lag)
  | 'uncertain' // oracle confidence too wide
  | 'paused'
  | 'other';

const MAP: Record<string, Outcome> = {
  NotActive: 'done',
  NotTriggered: 'not-triggered',
  Expired: 'expired',
  InsufficientBalanceOrAllowance: 'unfillable',
  InsufficientOutput: 'liquidity',
  SwapFailed: 'liquidity',
  StalePrice: 'stale',
  PriceTooUncertain: 'uncertain',
  EnforcedPause: 'paused',
};

export interface Classified {
  outcome: Outcome;
  /** Decoded custom error name, if any. */
  errorName?: string;
  message: string;
}

export function classify(err: unknown): Classified {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const errorName = reverted.data?.errorName ?? reverted.reason ?? undefined;
      if (errorName) {
        return { outcome: MAP[errorName] ?? 'other', errorName, message: err.shortMessage };
      }
    }
    return { outcome: 'other', message: err.shortMessage };
  }
  return { outcome: 'other', message: err instanceof Error ? err.message : String(err) };
}
