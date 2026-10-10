'use client';
import { useCallback, useState } from 'react';
import type { Hex } from 'viem';
import { publicClient } from './client';
import { readableError } from './errors';
import type { TxRequest } from './wallet';

export type StepState = 'pending' | 'active' | 'done' | 'error';

export interface Step {
  label: string;
  /** Build the tx (and simulate it, so contract errors surface before anything is signed). */
  build: () => Promise<TxRequest>;
}

export interface StepView {
  label: string;
  state: StepState;
  hash?: Hex;
}

/**
 * Runs transactions one after another with per-step progress (spinner → check), waiting for
 * each receipt. Errors become plain-English messages.
 */
export function useSteps(send: (tx: TxRequest) => Promise<Hex>) {
  const [steps, setSteps] = useState<StepView[]>([]);
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (list: Step[]): Promise<Hex[] | undefined> => {
      setError(undefined);
      setRunning(true);
      const view: StepView[] = list.map((s) => ({ label: s.label, state: 'pending' }));
      setSteps([...view]);
      const hashes: Hex[] = [];
      try {
        for (let i = 0; i < list.length; i++) {
          view[i] = { ...view[i]!, state: 'active' };
          setSteps([...view]);
          const tx = await list[i]!.build();
          const hash = await send(tx);
          view[i] = { ...view[i]!, hash };
          setSteps([...view]);
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
          view[i] = { ...view[i]!, state: 'done' };
          setSteps([...view]);
          hashes.push(hash);
        }
        return hashes;
      } catch (err) {
        const i = view.findIndex((s) => s.state === 'active');
        if (i >= 0) view[i] = { ...view[i]!, state: 'error' };
        setSteps([...view]);
        setError(readableError(err));
        return undefined;
      } finally {
        setRunning(false);
      }
    },
    [send],
  );

  const reset = useCallback(() => {
    setSteps([]);
    setError(undefined);
  }, []);

  return { steps, error, running, run, reset };
}
