import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

// Throwaway values for tests only (all-ones key, not a real key).
const base = {
  MODE: 'demo',
  CHAIN_ID: '10143',
  RPC_HTTP_URL: 'https://testnet-rpc.monad.xyz',
  RPC_WS_URL: 'wss://testnet-rpc.monad.xyz',
  KEEPER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  FLOOR_ADDRESS: '0x0000000000000000000000000000000000000001',
  ORACLE_ADDRESS: '0x0000000000000000000000000000000000000002',
  SWAP_TARGET: '0x0000000000000000000000000000000000000003',
};

describe('loadConfig', () => {
  it('parses a valid demo config and applies defaults', () => {
    const c = loadConfig(base);
    expect(c.CHAIN_ID).toBe(10143);
    expect(c.GAS_MULTIPLIER).toBe(1.15);
    expect(c.ZEROX_API_URL).toBe('https://api.0x.org');
    expect(c.ZEROX_API_KEY).toBeUndefined();
    expect(c.SWAP_SPENDER).toBe(base.SWAP_TARGET);
  });

  it('accepts keys without 0x and an absent websocket URL', () => {
    const c = loadConfig({ ...base, KEEPER_PRIVATE_KEY: '11'.repeat(32), RPC_WS_URL: '' });
    expect(c.KEEPER_PRIVATE_KEY).toBe(`0x${'11'.repeat(32)}`);
    expect(c.RPC_WS_URL).toBeUndefined();
  });

  it('enforces mode/chain pairing, the 0x key in live mode and the demo venue', () => {
    expect(() => loadConfig({ ...base, MODE: 'live', CHAIN_ID: '143' })).toThrow(/ZEROX_API_KEY/);
    expect(() => loadConfig({ ...base, CHAIN_ID: '143' })).toThrow(/testnet \(10143\) or anvil/);
    expect(() => loadConfig({ ...base, MODE: 'live', ZEROX_API_KEY: 'k' })).toThrow(/mainnet/);
    expect(() => loadConfig({ ...base, SWAP_TARGET: undefined })).toThrow(/SWAP_TARGET/);
    expect(() => loadConfig({ ...base, HERMES_URL: 'https://h.example' })).toThrow(
      /HERMES_API_KEY/,
    );
  });

  it('defaults the live venue to 0x AllowanceHolder', () => {
    const c = loadConfig({
      ...base,
      MODE: 'live',
      CHAIN_ID: '143',
      ZEROX_API_KEY: 'k',
      SWAP_TARGET: undefined,
    });
    expect(c.SWAP_TARGET).toBe('0x0000000000001fF3684f28c67538d4D072C22734');
    expect(c.SWAP_SPENDER).toBe(c.SWAP_TARGET);
  });

  it('reads addresses from a deployment file, with env overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'floor-keeper-'));
    const file = join(dir, '10143.json');
    writeFileSync(
      file,
      JSON.stringify({
        mode: 'demo',
        chainId: 10143,
        floorOrders: '0x940Bc18DEf074037D4D31966b732421986193Aef',
        oracle: '0x077298838c88C393b8e6A020547c8359e7F4288A',
        swapTarget: '0xd4539DD2cCBF8Cc14BB07e1FFaD919420101F653',
        swapSpender: '0xd4539DD2cCBF8Cc14BB07e1FFaD919420101F653',
      }),
    );
    const c = loadConfig({
      DEPLOYMENT_FILE: file,
      RPC_HTTP_URL: base.RPC_HTTP_URL,
      KEEPER_PRIVATE_KEY: base.KEEPER_PRIVATE_KEY,
      ORACLE_ADDRESS: '0x0000000000000000000000000000000000000009',
    });
    expect(c.FLOOR_ADDRESS).toBe('0x940Bc18DEf074037D4D31966b732421986193Aef');
    expect(c.SWAP_TARGET).toBe('0xd4539DD2cCBF8Cc14BB07e1FFaD919420101F653');
    expect(c.ORACLE_ADDRESS).toBe('0x0000000000000000000000000000000000000009');
  });

  it('rejects bad values without echoing secrets', () => {
    expect(() => loadConfig({ ...base, FLOOR_ADDRESS: '0x1234' })).toThrow(/FLOOR_ADDRESS/);
    expect(() => loadConfig({ ...base, RPC_WS_URL: 'https://x.example' })).toThrow(/RPC_WS_URL/);
    const secret = `0x${'ab'.repeat(31)}`;
    try {
      loadConfig({ ...base, KEEPER_PRIVATE_KEY: secret });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toMatch(/KEEPER_PRIVATE_KEY/);
      expect(String(e)).not.toContain(secret);
    }
  });
});
