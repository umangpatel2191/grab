import { describe, expect, it } from 'vitest';
import type { Candidate, ScanEvent } from '../../shared/types';
import { initialScan, scanReducer, type ScanAction, type ScanState } from '../src/ui/reducer';

let n = 0;
const cand = (url: string, groupId = 'web'): Candidate => ({
  id: `i${n++}`, kind: 'image', origin: 'img', groupId, sourceUrl: 'https://a.com/', url, posterUrl: null, posterFallback: null,
  width: null, height: null, dimsSource: 'unknown', mime: null, bytes: null, durationSec: null, title: null, downloadable: true, variants: [], warnings: [],
});

const run = (actions: ScanAction[], from: ScanState = initialScan) => actions.reduce(scanReducer, from);
const started: ScanAction = { type: 'started', jobId: 'job1', sources: [{ id: 's0', url: 'https://a.com/' }, { id: 's1', url: 'https://b.com/' }], rejected: [] };
const events = (evs: ScanEvent[], status: 'running' | 'done' | 'canceled' = 'running', next = evs.length): ScanAction => ({ type: 'events', events: evs, next, status });

describe('scan reducer', () => {
  it('moves idle -> starting -> running and creates one view per source', () => {
    const s = run([{ type: 'starting' }, started]);
    expect(s.phase).toBe('running');
    expect(s.sources.map((x) => x.status)).toEqual(['scanning', 'scanning']);
    expect(s.jobId).toBe('job1');
  });

  it('adds images as they arrive and drops exact duplicates across sources and batches', () => {
    const a = cand('https://a.com/1.jpg');
    const dup = { ...cand('https://a.com/1.jpg'), sourceUrl: 'https://b.com/' };
    const s = run([
      started,
      events([{ type: 'image.found', sourceId: 's0', candidates: [a, cand('https://a.com/2.jpg')] }]),
      events([{ type: 'image.found', sourceId: 's1', candidates: [dup, cand('https://a.com/3.jpg')] }]),
    ]);
    expect(s.items.map((c) => c.url)).toEqual(['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg']);
  });

  it('tracks per-source status, warnings and counts without touching other sources', () => {
    const s = run([
      started,
      events([
        { type: 'source.started', sourceId: 's0', url: 'https://a.com/' },
        { type: 'source.warning', sourceId: 's1', code: 'NOT_FOUND', message: 'gone' },
        { type: 'source.done', sourceId: 's1', count: 0 },
        { type: 'source.done', sourceId: 's0', count: 7 },
      ]),
    ]);
    expect(s.sources[0]).toMatchObject({ status: 'done', count: 7, warning: null });
    expect(s.sources[1]).toMatchObject({ status: 'done', count: 0, warning: { code: 'NOT_FOUND' } });
  });

  it('tracks crawl progress per source', () => {
    const s = run([started, events([{ type: 'source.progress', sourceId: 's0', pagesDone: 3, pagesTotal: 10, url: 'https://a.com/x' }])]);
    expect(s.sources[0].pages).toEqual({ done: 3, total: 10 });
    expect(s.sources[1].pages).toBeNull();
  });

  it('stores brand colors per source and resets them', () => {
    const colors = [{ hex: '#FF6600', role: 'theme' as const, source: 'theme-color', weight: 1000 }];
    const s = run([started, events([{ type: 'brand.found', sourceId: 's0', colors }])]);
    expect(s.brand).toEqual({ s0: colors });
    expect(run([{ type: 'starting' }], s).brand).toEqual({});
  });

  it('errors and reset', () => {
    const s = run([started, { type: 'fail', error: { code: 'NETWORK_ERROR', message: 'lost' } }]);
    expect(s.phase).toBe('error');
    expect(s.error?.message).toBe('lost');
    expect(run([{ type: 'reset' }], s)).toEqual(initialScan);
    expect(run([{ type: 'starting' }], s).error).toBeNull();
  });

  it('handles a large stream quickly', () => {
    const batches = Array.from({ length: 50 }, (_, b) => events([{ type: 'image.found', sourceId: 's0', candidates: Array.from({ length: 40 }, (_, i) => cand(`https://a.com/${b}-${i}.jpg`)) }]));
    const t = Date.now();
    const s = run([started, ...batches]);
    expect(s.items).toHaveLength(2000);
    expect(Date.now() - t).toBeLessThan(2500);
  });
});
