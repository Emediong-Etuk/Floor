import { loadConfig } from './config.ts';

// Phase 0 entry point: validates config only. Order tracking, pricing and execution
// land in Phase 3 (build prompt §7).
const config = loadConfig();
console.log(`floor keeper config ok: mode=${config.MODE} chainId=${config.CHAIN_ID}`);
