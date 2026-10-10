import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';
import { floorOrdersAbi, mockErc20Abi } from '@floor/shared';

/** Plain-English messages for the contract's custom errors (build prompt §4: readable failures). */
const MESSAGES: Record<string, string> = {
  SlippageTooHigh: 'The max price difference can be at most 5%.',
  InvalidLimitPrice: '"Never sell below" must be under your floor price.',
  InvalidBracketPrices: 'Your floor must be below your cash-out price.',
  InvalidTriggerPrice: 'Pick a floor price above zero.',
  InvalidExpiry: 'That expiry is already in the past.',
  OrderTooLarge: 'That is above the per-protection limit while Floor is unaudited.',
  TokenNotAllowed: 'Floor does not support that token yet.',
  ZeroAmount: 'Enter an amount to protect.',
  NotOrderOwner: 'Only the owner can change this protection.',
  NotActive: 'This protection is no longer active.',
  EnforcedPause: 'Floor is paused for maintenance. You can still cancel protections.',
  InsufficientBalanceOrAllowance: 'Not enough tokens or approval for this protection.',
  ERC20InsufficientBalance: "You don't have that many tokens.",
  ERC20InsufficientAllowance: 'The approval is too small. Try again.',
  MintCapExceeded: 'That is more than the test-token faucet allows at once.',
};

const ABI = [...floorOrdersAbi, ...mockErc20Abi.filter((x) => x.type === 'error')];

export function readableError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return (
        MESSAGES[reverted.data.errorName] ??
        `The contract refused this (${reverted.data.errorName}).`
      );
    }
    const msg = err.shortMessage || err.message;
    if (/insufficient funds|gas required exceeds/i.test(msg)) {
      return 'Add a little MON to your wallet for network fees.';
    }
    if (/rejected|denied/i.test(msg)) return 'Transaction cancelled.';
    return msg;
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Wallet SDKs sometimes only carry the raw revert data in the message.
  const data = msg.match(/0x[0-9a-fA-F]{8,}/)?.[0];
  if (data) {
    try {
      const d = decodeErrorResult({ abi: ABI, data: data as Hex });
      return MESSAGES[d.errorName] ?? `The contract refused this (${d.errorName}).`;
    } catch {
      /* not an error payload */
    }
  }
  if (/insufficient funds/i.test(msg)) return 'Add a little MON to your wallet for network fees.';
  if (/rejected|denied|cancel/i.test(msg)) return 'Transaction cancelled.';
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}
