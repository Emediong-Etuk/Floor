// Copies contracts/deployments/{10143,143}.json into src/lib/deployments.json so the app
// bundles real deployment addresses (never hand-typed). Run after each deploy:
//   pnpm --filter @floor/app sync-deployments
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const out = {};
for (const id of ['10143', '143']) {
  const f = new URL(`../../contracts/deployments/${id}.json`, import.meta.url);
  if (existsSync(f)) out[id] = JSON.parse(readFileSync(f, 'utf8'));
}
writeFileSync(
  new URL('../src/lib/deployments.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`synced deployments for chains: ${Object.keys(out).join(', ') || 'none'}`);
