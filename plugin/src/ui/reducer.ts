import type { BrandColor, Candidate, FontInfo, ReasonCode, ScanEvent, ScanSnapshot, TypeStyle } from '../../../shared/types';

export interface SourceView {
  id: string;
  url: string;
  status: 'scanning' | 'done';
  count: number;
  warning: { code: ReasonCode; message: string } | null;
  /** Crawl progress when more than one page of the site is read. */
  pages: { done: number; total: number } | null;
}

export interface ScanState {
  phase: 'idle' | 'starting' | 'running' | 'done' | 'canceled' | 'error';
  jobId: string | null;
  next: number;
  sources: SourceView[];
  rejected: { input: string; code: ReasonCode }[];
  items: Candidate[];
  brand: Record<string, BrandColor[]>;
  fonts: Record<string, FontInfo[]>;
  typeScale: Record<string, TypeStyle[]>;
  seen: Record<string, true>;
  error: { code: string; message: string } | null;
}

/** The last finished scan, kept in Figma until the next scan replaces it. */
export interface SavedScan {
  savedAt: number;
  urls: string[];
  snapshot: ScanSnapshot;
  sources: SourceView[];
  rejected: ScanState['rejected'];
  brand: ScanState['brand'];
  fonts: ScanState['fonts'];
  typeScale: ScanState['typeScale'];
}

export const initialScan: ScanState = {
  phase: 'idle',
  jobId: null,
  next: 0,
  sources: [],
  rejected: [],
  items: [],
  brand: {},
  fonts: {},
  typeScale: {},
  seen: {},
  error: null,
};

export type ScanAction =
  | { type: 'reset' }
  | { type: 'starting' }
  | { type: 'started'; jobId: string; sources: { id: string; url: string }[]; rejected: { input: string; code: ReasonCode }[] }
  | { type: 'events'; events: ScanEvent[]; next: number; status: 'running' | 'done' | 'canceled' }
  | { type: 'fail'; error: { code: string; message: string } }
  | { type: 'restored'; saved: SavedScan }
  | { type: 'rejob'; jobId: string };

function addItems(state: ScanState, list: Candidate[]): Pick<ScanState, 'items' | 'seen'> {
  const seen = { ...state.seen };
  const fresh: Candidate[] = [];
  for (const c of list) {
    const key = `${c.groupId}|${c.kind}|${c.url}`;
    if (seen[key]) continue;
    seen[key] = true;
    fresh.push(c);
  }
  return { items: fresh.length ? [...state.items, ...fresh] : state.items, seen };
}

function applyEvent(state: ScanState, ev: ScanEvent): ScanState {
  switch (ev.type) {
    case 'source.started':
      return { ...state, sources: state.sources.map((s) => (s.id === ev.sourceId ? { ...s, status: 'scanning' } : s)) };
    case 'image.found':
      return { ...state, ...addItems(state, ev.candidates) };
    case 'fonts.found':
      return { ...state, fonts: { ...state.fonts, [ev.sourceId]: ev.fonts }, typeScale: ev.typeScale?.length ? { ...state.typeScale, [ev.sourceId]: ev.typeScale } : state.typeScale };
    case 'brand.found':
      return { ...state, brand: { ...state.brand, [ev.sourceId]: ev.colors } };
    case 'source.warning':
      return { ...state, sources: state.sources.map((s) => (s.id === ev.sourceId ? { ...s, warning: { code: ev.code, message: ev.message } } : s)) };
    case 'source.progress':
      return { ...state, sources: state.sources.map((s) => (s.id === ev.sourceId ? { ...s, pages: { done: ev.pagesDone, total: ev.pagesTotal } } : s)) };
    case 'source.done':
      return { ...state, sources: state.sources.map((s) => (s.id === ev.sourceId ? { ...s, status: 'done', count: ev.count } : s)) };
    case 'job.done':
      return state; // phase is set from the poll status below
  }
}

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case 'reset':
      return initialScan;
    case 'starting':
      return { ...initialScan, phase: 'starting' };
    case 'started':
      return {
        ...initialScan,
        phase: 'running',
        jobId: action.jobId,
        rejected: action.rejected,
        sources: action.sources.map((s) => ({ id: s.id, url: s.url, status: 'scanning' as const, count: 0, warning: null, pages: null })),
      };
    case 'events': {
      let next = state;
      for (const ev of action.events) next = applyEvent(next, ev);
      const phase = action.status === 'running' ? 'running' : action.status;
      return { ...next, next: action.next, phase };
    }
    case 'fail':
      return { ...state, phase: 'error', error: action.error };
    case 'restored': {
      const { saved } = action;
      return {
        ...initialScan,
        ...addItems(initialScan, saved.snapshot.items),
        phase: 'done',
        jobId: null, // set by 'rejob' once the server has rebuilt the scan
        sources: saved.sources,
        rejected: saved.rejected,
        brand: saved.brand,
        fonts: saved.fonts,
        typeScale: saved.typeScale,
      };
    }
    case 'rejob':
      return { ...state, jobId: action.jobId };
  }
}
