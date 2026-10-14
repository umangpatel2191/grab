import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ScanOptions } from '../../../shared/types';
import { ApiClient, ApiFailure } from './api';
import { reasonText } from './lib';
import { initialScan, scanReducer } from './reducer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useScan(getApi: () => ApiClient) {
  const [state, dispatch] = useReducer(scanReducer, initialScan);
  const run = useRef(0);
  const jobRef = useRef<string | null>(null);

  useEffect(() => () => void (run.current = -1), []);

  const poll = useCallback(
    async (api: ApiClient, jobId: string, id: number, onLost: () => void) => {
      let since = 0;
      let failures = 0;
      for (;;) {
        if (run.current !== id) return;
        try {
          const r = await api.poll(jobId, since);
          if (run.current !== id) return;
          failures = 0;
          since = r.next;
          dispatch({ type: 'events', events: r.events, next: r.next, status: r.status });
          if (r.status !== 'running') return;
        } catch (err) {
          if (run.current !== id) return;
          if (err instanceof ApiFailure && err.code === 'NOT_FOUND') {
            // the server restarted (a deploy, or a free server recycled): run the scan again
            onLost();
            return;
          }
          failures++;
          if (failures >= 8) {
            dispatch({ type: 'fail', error: { code: 'NETWORK_ERROR', message: 'Lost connection to the server. Check your connection and try again.' } });
            return;
          }
        }
        await sleep(failures ? Math.min(4000, 400 * 2 ** failures) : 600);
      }
    },
    [dispatch],
  );

  const start = useCallback(
    async (urls: string[], options: ScanOptions, attempt = 0): Promise<void> => {
      const id = ++run.current;
      dispatch({ type: 'starting' });
      let api: ApiClient;
      try {
        api = getApi();
      } catch (err) {
        dispatch({ type: 'fail', error: { code: 'BAD_BACKEND', message: (err as Error).message } });
        return;
      }
      try {
        // after a restart the server may still be waking: wait for it first
        if (attempt > 0) await api.wake(() => undefined);
        const res = await api.createScan(urls, options);
        if (run.current !== id) return;
        jobRef.current = res.jobId;
        dispatch({ type: 'started', jobId: res.jobId, sources: res.sources, rejected: res.rejected });
        void poll(api, res.jobId, id, () => {
          if (run.current !== id) return;
          if (attempt < 2) void start(urls, options, attempt + 1);
          else dispatch({ type: 'fail', error: { code: 'NOT_FOUND', message: 'The server restarted several times during the scan. Try again in a minute, or with fewer pages.' } });
        });
      } catch (err) {
        if (run.current !== id) return;
        const f = err instanceof ApiFailure ? err : null;
        dispatch({ type: 'fail', error: { code: f?.code ?? 'INTERNAL', message: f ? reasonText(String(f.code), f.message) : 'Something went wrong.' } });
      }
    },
    [getApi, poll],
  );

  const cancel = useCallback(async () => {
    const jobId = jobRef.current;
    if (jobId) await getApi().cancel(jobId);
  }, [getApi]);

  const reset = useCallback(() => {
    run.current++;
    jobRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  return { state, start, cancel, reset, jobId: state.jobId };
}
