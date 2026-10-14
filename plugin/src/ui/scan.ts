import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ScanOptions } from '../../../shared/types';
import { ApiClient, ApiFailure } from './api';
import { reasonText } from './lib';
import { initialScan, scanReducer, type SavedScan } from './reducer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Figma keeps a few MB per plugin: very large scans are not saved rather than failing. */
const MAX_SAVED_CHARS = 4_500_000;

export function useScan(getApi: () => ApiClient, onSaved?: (saved: SavedScan) => void) {
  const [state, dispatch] = useReducer(scanReducer, initialScan);
  const urlsRef = useRef<string[]>([]);
  const savedJob = useRef<string | null>(null);

  // A finished scan is saved (signed by the server) so it survives closing the plugin
  // and server restarts. The next scan replaces it.
  useEffect(() => {
    if (state.phase !== 'done' || !state.jobId || savedJob.current === state.jobId || !onSaved) return;
    const jobId = state.jobId;
    savedJob.current = jobId;
    const current = state;
    void getApi()
      .snapshot(jobId)
      .then((snapshot) => {
        const saved: SavedScan = {
          savedAt: Date.now(),
          urls: urlsRef.current,
          snapshot,
          sources: current.sources,
          rejected: current.rejected,
          brand: current.brand,
          fonts: current.fonts,
          typeScale: current.typeScale,
        };
        if (JSON.stringify(saved).length <= MAX_SAVED_CHARS) onSaved(saved);
      })
      .catch(() => undefined); // saving is a convenience, never an error
  }, [state, getApi, onSaved]);
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
      urlsRef.current = urls;
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

  /** Show a saved scan right away, then ask the server to rebuild it for previews and downloads. */
  const restore = useCallback(
    async (saved: SavedScan) => {
      const id = ++run.current;
      urlsRef.current = saved.urls;
      dispatch({ type: 'restored', saved });
      try {
        const api = getApi();
        await api.wake(() => undefined);
        const { jobId } = await api.restore(saved.snapshot);
        if (run.current !== id) return;
        savedJob.current = jobId; // already saved: do not save it again
        jobRef.current = jobId;
        dispatch({ type: 'rejob', jobId });
      } catch {
        // the server cannot rebuild it (new server key, too old): fetch the site again
        if (run.current === id && saved.urls.length) void start(saved.urls, {});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getApi],
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

  return { state, start, cancel, reset, restore, jobId: state.jobId };
}
