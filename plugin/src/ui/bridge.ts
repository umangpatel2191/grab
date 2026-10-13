import type { InsertResult, MainToUi, UiToMain } from '../shared/messages';

export function sendToMain(msg: UiToMain) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

type Handler = (msg: MainToUi) => void;
const handlers = new Set<Handler>();

export function onMain(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data?.pluginMessage as MainToUi | undefined;
  if (msg && typeof msg === 'object' && 'type' in msg) handlers.forEach((h) => h(msg));
});

/** Wait for the main thread to answer one chunk (chunks are sent one at a time). */
export function waitForChunkResult(batchId: string, timeoutMs = 120000): Promise<InsertResult[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('Figma did not answer in time.'));
    }, timeoutMs);
    const off = onMain((m) => {
      if (m.type === 'insert:chunk-result' && m.batchId === batchId) {
        clearTimeout(timer);
        off();
        resolve(m.results);
      }
    });
  });
}

export function waitForInsertDone(batchId: string, timeoutMs = 60000): Promise<{ placed: number; failed: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ placed: 0, failed: 0 });
    }, timeoutMs);
    const off = onMain((m) => {
      if (m.type === 'insert:done' && m.batchId === batchId) {
        clearTimeout(timer);
        off();
        resolve({ placed: m.placed, failed: m.failed });
      }
    });
  });
}

/** Ask Figma to create a palette frame (and color styles) and wait for the answer. */
export function insertPalette(name: string, colors: { hex: string; label: string }[], styles: boolean, timeoutMs = 20000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ ok: false, message: 'Figma did not answer in time.' });
    }, timeoutMs);
    const off = onMain((m) => {
      if (m.type === 'palette:done') {
        clearTimeout(timer);
        off();
        resolve({ ok: m.ok, message: m.message });
      }
    });
    sendToMain({ type: 'palette:insert', name, colors, styles });
  });
}

/** Ask Figma to build a type specimen (and text styles) for the site's fonts. */
export function insertFonts(name: string, fonts: { family: string; role: string; weights: string[] }[], timeoutMs = 30000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ ok: false, message: 'Figma did not answer in time.' });
    }, timeoutMs);
    const off = onMain((m) => {
      if (m.type === 'fonts:done') {
        clearTimeout(timer);
        off();
        resolve({ ok: m.ok, message: m.message });
      }
    });
    sendToMain({ type: 'fonts:insert', name, fonts });
  });
}

/** Send the collected brand book to Figma and wait until it is built. */
export function sendBrandBook(data: import('../shared/messages').BrandBookData, timeoutMs = 180000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve({ ok: false, message: 'Figma did not answer in time.' });
    }, timeoutMs);
    const off = onMain((m) => {
      if (m.type === 'brandbook:done') {
        clearTimeout(timer);
        off();
        resolve({ ok: m.ok, message: m.message });
      }
    });
    sendToMain({ type: 'brandbook:build', data });
  });
}
