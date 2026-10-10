import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { floorOrdersAbi } from '@floor/shared';
import { deployment } from '@/lib/config';
import { handle, json, keeperKey, lastSweep, serverClient } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** GET: keeper status for the /demo panel (address, balance, active orders, last sweep). */
export function GET() {
  return handle(async () => {
    const active = await serverClient.readContract({
      address: deployment.floorOrders,
      abi: floorOrdersAbi,
      functionName: 'activeOrderCount',
    });
    if (!keeperKey) return json({ mode: 'on-demand', configured: false, activeOrders: active });
    const address = privateKeyToAccount(keeperKey).address;
    const balance = await serverClient.getBalance({ address });
    return json({
      mode: 'on-demand',
      configured: true,
      keeper: address,
      balanceMon: formatEther(balance),
      activeOrders: active,
      lastSweep: lastSweep
        ? { at: lastSweep.at, durationMs: lastSweep.durationMs, events: lastSweep.events }
        : null,
    });
  });
}
