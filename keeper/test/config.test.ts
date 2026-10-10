import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

// Throwaway values for tests only (the key is the well-known all-ones test value, not a real key).
const base = {
  MODE: 'demo',
  CHAIN_ID: '10143',
  RPC_HTTP_URL: 'https://testnet-rpc.monad.xyz',
  RPC_WS_URL: 'wss://testnet-rpc.monad.xyz',
  KEEPER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  FLOOR_ADDRESS: '0x0000000000000000000000000000000000000001',
  ORACLE_ADDRESS: '0x0000000000000000000000000000000000000002',
};

describe('loadConfig', () => {
  it('parses a valid demo config and applies defaults', () => {
    const c = loadConfig(base);
    expect(c.CHAIN_ID).toBe(10143);
    expect(c.GAS_MULTIPLIER).toBe(1.15);
    expect(c.ZEROX_API_URL).toBe('https://api.0x.org');
    expect(c.ZEROX_API_KEY).toBeUndefined();
  });

  it('requires a 0x API key in live mode and rejects demo mode on mainnet', () => {
    expect(() => loadConfig({ ...base, MODE: 'live', CHAIN_ID: '143' })).toThrow(/ZEROX_API_KEY/);
    expect(() => loadConfig({ ...base, CHAIN_ID: '143' })).toThrow(/testnet \(10143\) only/);
  });

  it('rejects bad addresses, keys and websocket URLs', () => {
    expect(() => loadConfig({ ...base, FLOOR_ADDRESS: '0x1234' })).toThrow(/FLOOR_ADDRESS/);
    expect(() => loadConfig({ ...base, RPC_WS_URL: 'https://x.example' })).toThrow(/RPC_WS_URL/);
    expect(() => loadConfig({ ...base, KEEPER_PRIVATE_KEY: '0xabc' })).toThrow(
      /KEEPER_PRIVATE_KEY/,
    );
  });

  it('never includes secret values in the error message', () => {
    const secret = `0x${'ab'.repeat(31)}`; // wrong length, so invalid
    try {
      loadConfig({ ...base, KEEPER_PRIVATE_KEY: secret });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(secret);
    }
  });
});
