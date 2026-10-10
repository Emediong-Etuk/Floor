import { describe, expect, it } from 'vitest';
import { ContractFunctionRevertedError, encodeErrorResult } from 'viem';
import { executeAbi } from '../src/abi.ts';
import { classify } from '../src/errors.ts';

function revert(errorName: string, args: readonly unknown[] = []) {
  const data = encodeErrorResult({ abi: executeAbi, errorName, args } as never);
  return new ContractFunctionRevertedError({ abi: executeAbi, data, functionName: 'execute' });
}

describe('classify', () => {
  it('maps FloorOrders errors to keeper outcomes', () => {
    expect(classify(revert('NotActive', [1n])).outcome).toBe('done');
    expect(classify(revert('NotTriggered', [1n, 2n])).outcome).toBe('not-triggered');
    expect(classify(revert('Expired', [1n])).outcome).toBe('expired');
    expect(classify(revert('InsufficientBalanceOrAllowance', [0n, 0n, 1n])).outcome).toBe(
      'unfillable',
    );
    expect(classify(revert('InsufficientOutput', [1n, 2n])).outcome).toBe('liquidity');
    expect(classify(revert('EnforcedPause')).outcome).toBe('paused');
  });

  it('decodes errors that bubble up from the venue and adapter', () => {
    const c = classify(revert('ERC20InsufficientAllowance', [`0x${'00'.repeat(20)}`, 0n, 1n]));
    expect(c.errorName).toBe('ERC20InsufficientAllowance');
    expect(c.outcome).toBe('other');
    expect(classify(revert('InvalidPrice', [-1n])).errorName).toBe('InvalidPrice');
  });

  it('falls back to "other" for non-contract errors', () => {
    expect(classify(new Error('socket hang up'))).toEqual({
      outcome: 'other',
      message: 'socket hang up',
    });
  });
});
