import { useMemo } from 'react';
import { parseUrlInput } from '../../../../shared/urls';
import type { HealthResponse } from '../../../../shared/types';
import type { HistoryEntry, Settings } from '../../shared/messages';
import { Badge, Button } from './Bits';
import { hostLabel, reasonText } from '../lib';
import type { SavedScan } from '../reducer';

export type ServerStatus = { state: 'checking' | 'up' | 'waking' | 'down'; health: HealthResponse | null; attempt?: number };

interface Props {
  input: string;
  setInput: (v: string) => void;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  history: HistoryEntry[];
  server: ServerStatus;
  starting: boolean;
  startingFor: number;
  error: string | null;
  onFetch: (urls: string[]) => void;
  onClearHistory: () => void;
  lastScan: SavedScan | null;
  onOpenLast: () => void;
}

export function Home({ input, setInput, settings, setSettings, history, server, starting, startingFor, error, onFetch, onClearHistory, lastScan, onOpenLast }: Props) {
  const max = server.health?.limits.maxUrlsPerScan ?? 10;
  const parsed = useMemo(() => parseUrlInput(input, max), [input, max]);
  const canFetch = parsed.valid.length > 0 && !starting;
  const deepOk = server.health?.features.deepScan ?? false;
  const maxPages = server.health?.limits.maxPagesPerSite ?? 200;

  return (
    <div className="home">
      <div className="hero">
        <h2>Collect everything from a website</h2>
        <p>Brand colors, every image, icon, SVG, GIF and video across the whole site. Preview first, take only what you need.</p>
      </div>

      {lastScan ? (
        <button type="button" className="last-scan" onClick={onOpenLast} title={lastScan.urls.join('\n')}>
          <span className="last-scan-text">
            <strong>Last scan · {hostLabel(lastScan.urls[0] ?? lastScan.snapshot.sources[0]?.url ?? '')}{lastScan.urls.length > 1 ? ` +${lastScan.urls.length - 1}` : ''}</strong>
            <span>{lastScan.snapshot.items.length} assets · {Object.values(lastScan.brand).flat().length} colors · {ago(lastScan.savedAt)}. Kept until you scan again.</span>
          </span>
          <span className="last-scan-open">Open →</span>
        </button>
      ) : null}

      <label className="label" htmlFor="links">Website links</label>
      <textarea
        id="links"
        className="textarea"
        value={input}
        autoFocus
        spellCheck={false}
        placeholder={'https://example.com\nhttps://another-site.com/portfolio'}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canFetch) onFetch(parsed.valid);
        }}
      />

      <div className="parse-line" aria-live="polite">
        {input.trim() === '' ? (
          <span className="muted">One link per line. Nothing is scanned until you press Fetch.</span>
        ) : (
          <>
            <Badge tone={parsed.valid.length ? 'good' : 'bad'}>{parsed.valid.length} link{parsed.valid.length === 1 ? '' : 's'} ready</Badge>
            {parsed.duplicates ? <Badge>{parsed.duplicates} duplicate merged</Badge> : null}
            {parsed.invalid.length ? <Badge tone="bad">{parsed.invalid.length} {parsed.invalid[0].code === 'TOO_LARGE' ? `over the limit (max ${max})` : 'not a link'}</Badge> : null}
          </>
        )}
      </div>
      {parsed.invalid.length ? (
        <ul className="invalid-list">
          {parsed.invalid.slice(0, 3).map((i, k) => <li key={k}><code>{i.input.slice(0, 48)}</code> {reasonText(i.code)}</li>)}
        </ul>
      ) : null}

      <div className="options">
        <label className="check-row">
          <span>Pages per site <small>{settings.pages === 1 ? 'only the pasted link' : 'follows the menu, footer and sitemap'}</small></span>
          <select className="select" value={settings.pages} onChange={(e) => setSettings({ pages: Number(e.target.value) })} aria-label="Pages per site">
            {[1, 5, 10, 25, 50, 100, 200].filter((n) => n <= maxPages).map((n) => <option key={n} value={n}>{n === 1 ? 'Just this page' : n === maxPages ? `Whole site (up to ${n})` : `Up to ${n}`}</option>)}
          </select>
        </label>
        <label className={`check-row${deepOk ? '' : ' disabled'}`}>
          <input type="checkbox" disabled={!deepOk} checked={settings.deep && deepOk} onChange={(e) => setSettings({ deep: e.target.checked })} />
          <span>Deep scan <small>{deepOk ? 'renders every page in a browser; JavaScript-only pages are rendered automatically' : 'not installed on this server'}</small></span>
        </label>
      </div>

      <Button variant="primary" className="big" icon="download" disabled={!canFetch} onClick={() => onFetch(parsed.valid)}>
        {starting ? 'Starting…' : 'Fetch'} <kbd>⌘↵</kbd>
      </Button>

      {starting && startingFor > 4 ? (
        <div className="notice" role="status">
          <strong>Server is waking up</strong>
          <span>Free servers sleep when idle. The first scan can take up to a minute.</span>
        </div>
      ) : null}
      {error ? (
        <div className="error-box" role="alert">
          <strong>Could not start</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {history.length > 0 ? (
        <section className="history" aria-label="Recent scans">
          <div className="history-head">
            <span className="label">Recent</span>
            <button type="button" className="link" onClick={onClearHistory}>Clear</button>
          </div>
          {history.map((h) => (
            <button key={h.at} type="button" className="history-item" onClick={() => setInput(h.urls.join('\n'))} title={h.urls.join('\n')}>
              <span>{h.urls[0].replace(/^https?:\/\//, '').slice(0, 42)}</span>
              {h.urls.length > 1 ? <Badge>+{h.urls.length - 1}</Badge> : null}
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
