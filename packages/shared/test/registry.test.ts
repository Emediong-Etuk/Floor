import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAddress, isAddress } from 'viem';
import {
  MAINNET_CONTRACTS,
  MAINNET_TOKENS,
  TESTNET_CONTRACTS,
  chainFor,
  monadMainnet,
  monadTestnet,
} from '../src/index.ts';

describe('chains', () => {
  it('maps chain ids to Monad definitions', () => {
    expect(chainFor(143)).toBe(monadMainnet);
    expect(chainFor(10143)).toBe(monadTestnet);
    expect(() => chainFor(1)).toThrow(/Unsupported chain id 1/);
  });
});

describe('token registry', () => {
  const tokens = Object.values(MAINNET_TOKENS);

  it('has valid addresses with correct checksums', () => {
    for (const t of tokens) {
      expect(isAddress(t.address, { strict: true }), t.symbol).toBe(true);
      expect(getAddress(t.address)).toBe(t.address);
    }
  });

  it('has 32-byte Pyth feed ids and unique feeds', () => {
    for (const t of tokens) expect(t.pythFeedId, t.symbol).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Set(tokens.map((t) => t.pythFeedId)).size).toBe(tokens.length);
  });

  it('covers 6, 8 and 18 decimals and has exactly one settlement asset', () => {
    expect(new Set(tokens.map((t) => t.decimals))).toEqual(new Set([6, 8, 18]));
    expect(tokens.filter((t) => t.role === 'out').map((t) => t.symbol)).toEqual(['USDC']);
  });
});

describe('third-party contracts', () => {
  it('are valid addresses', () => {
    for (const a of [...Object.values(MAINNET_CONTRACTS), ...Object.values(TESTNET_CONTRACTS)]) {
      expect(isAddress(a, { strict: false })).toBe(true);
    }
  });
});

describe('Solidity mainnet config stays in sync', () => {
  // contracts/script/config/MonadMainnet.sol is what DeployLive uses on chain 143.
  const sol = readFileSync(
    fileURLToPath(new URL('../../../contracts/script/config/MonadMainnet.sol', import.meta.url)),
    'utf8',
  );
  const constant = (name: string) => {
    const m = sol.match(new RegExp(`constant ${name}\\s*=\\s*(0x[0-9a-fA-F]+);`));
    if (!m?.[1]) throw new Error(`${name} not found in MonadMainnet.sol`);
    return m[1].toLowerCase();
  };

  it('has the same token addresses and feed ids', () => {
    const pairs: [string, string, string][] = [
      ['WMON', 'MON_USD', 'WMON'],
      ['WETH', 'ETH_USD', 'WETH'],
      ['CBBTC', 'CBBTC_USD', 'CBBTC'],
      ['USDC', 'USDC_USD', 'USDC'],
    ];
    for (const [addr, feed, key] of pairs) {
      const t = MAINNET_TOKENS[key as keyof typeof MAINNET_TOKENS];
      expect(constant(addr), key).toBe(t.address.toLowerCase());
      expect(constant(feed), key).toBe(t.pythFeedId.toLowerCase());
    }
  });

  it('has the same Pyth and 0x AllowanceHolder addresses', () => {
    expect(constant('PYTH')).toBe(MAINNET_CONTRACTS.pyth.toLowerCase());
    expect(constant('ZEROX_ALLOWANCE_HOLDER')).toBe(
      MAINNET_CONTRACTS.zeroExAllowanceHolder.toLowerCase(),
    );
  });
});
