// Loads grid previews through fetch (not <img src>) so we can limit parallel requests
// and read the real image size from the response headers.
export interface PreviewResult {
  blobUrl: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

const CONCURRENCY = 4;
const cache = new Map<string, Promise<PreviewResult>>();
const waiting: (() => void)[] = [];
let active = 0;

function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => { active++; resolve(); }));
}

function release() {
  active--;
  waiting.shift()?.();
}

const num = (v: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function loadPreview(url: string): Promise<PreviewResult> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    await acquire();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`preview ${res.status}`);
      const blob = await res.blob();
      return {
        blobUrl: URL.createObjectURL(blob),
        width: num(res.headers.get('x-grab-width')),
        height: num(res.headers.get('x-grab-height')),
        bytes: num(res.headers.get('x-grab-bytes')),
      };
    } finally {
      release();
    }
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url)); // allow retry after a failure
  return p;
}

export function clearPreviews() {
  for (const p of cache.values()) p.then((r) => URL.revokeObjectURL(r.blobUrl)).catch(() => undefined);
  cache.clear();
}
