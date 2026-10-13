import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candidate, FontInfo } from '../../../../shared/types';
import { downloadOne, downloadZip, failureText, insertIntoFigma, type Failure, type Progress as Prog } from '../actions';
import type { ApiClient } from '../api';
import { insertFonts, insertPalette, sendBrandBook } from '../bridge';
import { collectBrandBook, exportTokens, type BrandSource } from '../actions';
import {
  DEFAULT_FILTERS, applyFilters, categoryOf, copyText, formatDims, hostLabel, mergeBrand, pageLabel, reasonText,
  ROLE_LABEL, type Category, type Filters, type Measured,
} from '../lib';
import type { ScanState } from '../reducer';
import type { Settings } from '../../shared/messages';
import { Badge, Button, Icon, Progress } from './Bits';
import { BrandColors } from './BrandColors';
import { Fonts } from './Fonts';
import { Lightbox } from './Lightbox';
import { Tile, type TileVariant } from './Tile';

interface Props {
  scan: ScanState;
  api: ApiClient;
  settings: Settings;
  serverDeep: boolean;
  onNew: () => void;
  onCancel: () => void;
  onToast: (text: string, tone?: 'ok' | 'error') => void;
}

type Op = { kind: 'insert' | 'zip'; label: string; progress: Prog } | null;
interface Summary {
  title: string;
  ok: boolean;
  failures: Failure[];
  retry?: () => void;
}

type View = 'all' | 'colors' | 'fonts' | Category;
const SECTIONS: { key: Category; title: string; variant: TileVariant; step: number }[] = [
  { key: 'image', title: 'Images', variant: 'card', step: 24 },
  { key: 'icon', title: 'Icons & logos', variant: 'icon', step: 36 },
  { key: 'gif', title: 'GIFs', variant: 'card', step: 12 },
  { key: 'video', title: 'Videos', variant: 'card', step: 12 },
];

export function Results({ scan, api, settings: _settings, serverDeep, onNew, onCancel, onToast }: Props) {
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, showSmall: true });
  const [view, setView] = useState<View>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [measured, setMeasured] = useState<Measured>({});
  const [op, setOp] = useState<Op>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const abort = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const jobId = scan.jobId!;

  // ---- measuring: collect many small updates into one render
  const pending = useRef<Measured>({});
  const flush = useRef<number | null>(null);
  const onMeasure = useCallback((id: string, w: number, h: number) => {
    pending.current[id] = { w, h };
    if (flush.current === null) {
      flush.current = window.setTimeout(() => {
        flush.current = null;
        const batch = pending.current;
        pending.current = {};
        setMeasured((m) => ({ ...m, ...batch }));
      }, 200);
    }
  }, []);
  useEffect(() => () => { if (flush.current !== null) clearTimeout(flush.current); }, []);

  // ---- derived lists
  const webItems = useMemo(() => scan.items.filter((c) => c.groupId === 'web'), [scan.items]);
  const brand = useMemo(() => mergeBrand(scan.brand), [scan.brand]);
  const searching = filters.query.trim() !== '';
  const matched = useMemo(() => applyFilters(webItems, { ...filters, type: 'all' }, measured), [webItems, filters, measured]);
  const groups = useMemo(() => {
    const g: Record<Category, Candidate[]> = { image: [], icon: [], gif: [], video: [] };
    for (const c of matched) g[categoryOf(c, measured)].push(c);
    return g;
  }, [matched, measured]);
  const allGroups = useMemo(() => {
    const g: Record<Category, number> = { image: 0, icon: 0, gif: 0, video: 0 };
    for (const c of webItems) g[categoryOf(c, measured)]++;
    return g;
  }, [webItems, measured]);
  const webTotal = webItems.length;
  const visibleSections = SECTIONS.filter((s) => (view === 'all' || view === s.key) && groups[s.key].length > 0);
  const filtered: Candidate[] = visibleSections.flatMap((s) => groups[s.key]);
  const filteredRef = useRef<Candidate[]>([]);
  filteredRef.current = filtered;
  const byId = useMemo(() => new Map(scan.items.map((c) => [c.id, c])), [scan.items]);
  const selectedItems = useMemo(() => [...selected].map((id) => byId.get(id)).filter(Boolean) as Candidate[], [selected, byId]);
  const running = scan.phase === 'running';

  // ---- selection
  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);
  const selectAllVisible = () => setSelected((s) => new Set([...s, ...filtered.map((c) => c.id)]));
  const clearSelection = () => setSelected(new Set());

  // ---- single item actions
  const onCopy = useCallback(async (c: Candidate) => {
    onToast((await copyText(c.url)) ? 'Link copied' : 'Could not copy', 'ok');
  }, [onToast]);
  const onOpen = useCallback((c: Candidate) => {
    if (c.url.startsWith('data:')) return onToast('This image is embedded in the page. Use Download.', 'error');
    window.open(c.url, '_blank', 'noopener');
  }, [onToast]);
  const onDownload = useCallback(async (c: Candidate) => {
    setBusyIds((b) => new Set(b).add(c.id));
    try {
      await downloadOne(api, jobId, c);
    } catch (err) {
      onToast(failureText(err), 'error');
    } finally {
      setBusyIds((b) => {
        const n = new Set(b);
        n.delete(c.id);
        return n;
      });
    }
  }, [api, jobId, onToast]);

  // ---- bulk actions
  const startOp = (kind: 'insert' | 'zip', label: string, total: number) => {
    abort.current = new AbortController();
    setSummary(null);
    setOp({ kind, label, progress: { done: 0, total, failed: 0 } });
    return abort.current;
  };

  const onInsertOne = useCallback((c: Candidate) => {
    if (!op) void runInsert([c]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op]);

  const runInsert = async (items: Candidate[]) => {
    const usable = items.filter((c) => c.kind === 'image' || c.posterUrl);
    const skipped = items.length - usable.length;
    if (!usable.length) return onToast('Nothing here can be inserted (videos without a poster image).', 'error');
    const hosts = [...new Set(usable.map((c) => hostLabel(c.sourceUrl)))];
    const frameName = `GRAB · ${hosts.length === 1 ? hosts[0] : `${hosts.length} sources`}`;
    const ctl = startOp('insert', 'Inserting into Figma', usable.length);
    const result = await insertIntoFigma(api, jobId, usable, frameName, (p) => setOp((o) => (o ? { ...o, progress: p } : o)), ctl.signal);
    setOp(null);
    const failedItems = result.failures.map((f) => byId.get(f.id)).filter(Boolean) as Candidate[];
    setSummary({
      title: `${result.placed} inserted${result.failures.length ? ` · ${result.failures.length} failed` : ''}${skipped ? ` · ${skipped} skipped (no image)` : ''}${result.canceled ? ' · stopped' : ''}`,
      ok: result.failures.length === 0,
      failures: result.failures,
      retry: failedItems.length ? () => void runInsert(failedItems) : undefined,
    });
  };

  const runDownload = async (items: Candidate[]) => {
    const direct = items.filter((c) => c.downloadable);
    const skipped = items.length - direct.length;
    if (!direct.length) return onToast('These items can only be opened at the source.', 'error');
    if (direct.length === 1) {
      await onDownload(direct[0]);
      if (skipped) onToast(`${skipped} item${skipped > 1 ? 's' : ''} can only be opened at the source`);
      return;
    }
    const ctl = startOp('zip', 'Building ZIP', Math.min(direct.length, 100));
    const result = await downloadZip(api, jobId, direct, (p) => setOp((o) => (o ? { ...o, progress: p } : o)), ctl.signal);
    setOp(null);
    const failedItems = result.failures.map((f) => byId.get(f.id)).filter(Boolean) as Candidate[];
    const extra = [skipped ? `${skipped} open-at-source only` : '', result.skipped > skipped ? `${result.skipped - skipped} over the 100 file limit` : ''].filter(Boolean).join(' · ');
    setSummary({
      title: result.canceled ? 'Canceled' : `ZIP saved with ${result.ok} file${result.ok === 1 ? '' : 's'}${result.failures.length ? ` · ${result.failures.length} failed` : ''}${extra ? ' · ' + extra : ''}`,
      ok: result.failures.length === 0 && !result.canceled,
      failures: result.failures,
      retry: failedItems.length ? () => void runDownload(failedItems) : undefined,
    });
  };

  const copySelected = async () => {
    const text = selectedItems.map((c) => c.url).join('\n');
    onToast((await copyText(text)) ? `${selectedItems.length} link${selectedItems.length === 1 ? '' : 's'} copied` : 'Could not copy', 'ok');
  };

  // ---- keyboard shortcuts (never while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Escape') {
        if (op) abort.current?.abort();
        else clearSelection();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'a') selectAllVisible();
      else if (e.key === 'd' && selectedItems.length && !op) void runDownload(selectedItems);
      else if (e.key === 'i' && selectedItems.length && !op) void runInsert(selectedItems);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const sourceDone = scan.sources.filter((s) => s.status === 'done').length;
  const previewUrl = useCallback((c: Candidate) => api.previewUrl(jobId, c.id), [api, jobId]);
  const largePreview = useCallback((c: Candidate, w: number) => api.previewUrl(jobId, c.id, w), [api, jobId]);
  const [viewing, setViewing] = useState<number | null>(null);
  const onView = useCallback((c: Candidate) => setViewing(filteredRef.current.findIndex((x) => x.id === c.id)), []);
  const host = scan.sources[0] ? hostLabel(scan.sources[0].url) : 'site';

  const copyHex = async (hex: string) => onToast((await copyText(hex)) ? `${hex} copied` : 'Could not copy', 'ok');
  const copyAllHex = async () => onToast((await copyText(brand.map((c) => c.hex).join('\n'))) ? `${brand.length} colors copied` : 'Could not copy', 'ok');
  const fonts = useMemo(() => {
    const m = new Map<string, FontInfo>();
    for (const list of Object.values(scan.fonts)) for (const f of list) if (!m.has(f.family.toLowerCase())) m.set(f.family.toLowerCase(), f);
    return [...m.values()].sort((a, b) => b.weight - a.weight);
  }, [scan.fonts]);
  const addFonts = async () => {
    const r = await insertFonts(`GRAB · ${host} · Fonts`, fonts.map((f) => ({ family: f.family, role: f.roles[0] ?? 'other', weights: f.weights })));
    onToast(r.message, r.ok ? 'ok' : 'error');
  };
  const copyFontText = async (t: string) => {
    onToast((await copyText(t)) ? `Copied ${t.length > 40 ? 'font names' : t}` : 'Could not copy', 'ok');
  };

  const typeScale = useMemo(() => Object.values(scan.typeScale)[0] ?? [], [scan.typeScale]);
  const [bookStep, setBookStep] = useState<string | null>(null);
  const brandSource = (): BrandSource => ({ items: webItems, colors: brand, fonts, typeScale, host, measured });
  const buildBook = async () => {
    if (bookStep) return;
    const ctl = new AbortController();
    try {
      setBookStep('Collecting');
      const data = await collectBrandBook(api, jobId, brandSource(), setBookStep, ctl.signal);
      setBookStep('Designing pages in Figma');
      const r = await sendBrandBook(data);
      onToast(r.message, r.ok ? 'ok' : 'error');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not build the brand book.', 'error');
    } finally {
      setBookStep(null);
    }
  };

  const addPalette = async () => {
    const r = await insertPalette(`GRAB · ${host} · Colors`, brand.map((c) => ({ hex: c.hex, label: ROLE_LABEL[c.role] })), true);
    onToast(r.message, r.ok ? 'ok' : 'error');
  };

  const showColors = brand.length > 0 && !searching && (view === 'all' || view === 'colors');
  const showFonts = fonts.length > 0 && !searching && (view === 'all' || view === 'fonts');
  const nothing = !showColors && !showFonts && visibleSections.length === 0;
  const chips: { key: View; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: webTotal + brand.length + fonts.length },
    { key: 'colors', label: 'Colors', n: brand.length },
    { key: 'fonts', label: 'Fonts', n: fonts.length },
    { key: 'image', label: 'Images', n: allGroups.image },
    { key: 'icon', label: 'Icons', n: allGroups.icon },
    { key: 'gif', label: 'GIFs', n: allGroups.gif },
    { key: 'video', label: 'Videos', n: allGroups.video },
  ];

  const renderTile = (c: Candidate, variant: TileVariant) => (
    <Tile
      key={c.id}
      c={c}
      variant={variant}
      previewUrl={previewUrl(c)}
      selected={selected.has(c.id)}
      dimsText={formatDims(c, measured)}
      busy={busyIds.has(c.id)}
      onToggle={toggle}
      onMeasure={onMeasure}
      onCopy={onCopy}
      onOpen={onOpen}
      onDownload={onDownload}
      onInsert={onInsertOne}
      onView={onView}
    />
  );

  return (
    <div className="results">
      <div className="topbar">
        <Button small variant="primary" icon="back" onClick={onNew}>New scan</Button>
        <div className="topbar-status" aria-live="polite">
          {running ? <Badge tone="accent">Scanning {sourceDone}/{scan.sources.length}</Badge> : null}
          {scan.phase === 'done' ? <Badge tone="good">Done</Badge> : null}
          {scan.phase === 'canceled' ? <Badge tone="bad">Stopped</Badge> : null}
        </div>
        {running ? <Button small variant="danger" icon="close" onClick={onCancel}>Stop</Button> : null}
      </div>

      <div className="sources" aria-label="Scanned pages">
        {scan.sources.map((s) => (
          <div key={s.id} className="source">
            <div className="source-head">
              <span className={`dot ${s.status === 'scanning' ? 'busy' : s.warning && s.count === 0 ? 'bad' : 'good'}`} aria-hidden="true" />
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="source-url" title={s.url}>{pageLabel(s.url)}</a>
              <span className="source-count">{s.status === 'scanning' ? (s.pages ? `${s.pages.done}/${s.pages.total} pages` : '…') : s.pages && s.pages.done > 1 ? `${s.count} · ${s.pages.done} pages` : s.count}</span>
            </div>
            {s.warning ? <div className="source-warning">{s.warning.message || reasonText(s.warning.code)}</div> : null}
          </div>
        ))}
        {scan.rejected.map((r, i) => (
          <div key={`r${i}`} className="source">
            <div className="source-head"><span className="dot bad" aria-hidden="true" /><span className="source-url">{r.input}</span></div>
            <div className="source-warning">{reasonText(r.code)}</div>
          </div>
        ))}
      </div>

      <div className="scroll">
        {!running && (brand.length || fonts.length || webItems.some((c) => c.role === 'logo')) ? (
          <section className="brandkit" aria-label="Brand kit">
            <div className="brandkit-text">
              <strong>Brand kit for {host}</strong>
              <span>{bookStep ? `${bookStep}…` : `${brand.length} colors · ${fonts.length} fonts${typeScale.length ? ` · ${typeScale.length} text sizes` : ''}${webItems.some((c) => c.role === 'logo') ? ' · logo' : ''}`}</span>
            </div>
            <div className="brandkit-actions">
              <Button small icon="code" onClick={() => { exportTokens(brandSource()); onToast('Design tokens saved', 'ok'); }}>Export tokens</Button>
              <Button small variant="primary" icon="book" disabled={!!bookStep} onClick={() => void buildBook()}>{bookStep ? 'Building…' : 'Create Brand Book'}</Button>
            </div>
          </section>
        ) : null}
        <>
            <div className="filters">
              <input ref={searchRef} className="input" type="search" placeholder="Search  ( / )" value={filters.query} onChange={(e) => setF({ query: e.target.value })} aria-label="Search by link or description" />
              <div className="chips" role="group" aria-label="Show">
                {chips.filter((c) => c.key === 'all' || c.n > 0).map((c) => (
                  <button key={c.key} type="button" className={`chip${view === c.key ? ' on' : ''}`} aria-pressed={view === c.key} onClick={() => setView(c.key)}>
                    {c.label}{c.key !== 'all' ? <span>{c.n}</span> : null}
                  </button>
                ))}
              </div>
            </div>

            {showColors ? <BrandColors colors={brand} onCopy={copyHex} onCopyAll={copyAllHex} onInsert={addPalette} /> : null}
            {showFonts ? <Fonts fonts={fonts} onCopy={copyFontText} onInsert={addFonts} /> : null}

            {visibleSections.map((s) => {
              const list = groups[s.key];
              const limit = limits[s.key] ?? s.step;
              const shown = list.slice(0, limit);
              return (
                <section key={s.key} className="section" aria-label={s.title}>
                  <header className="section-head">
                    <h2>{s.title} <span className="count">{list.length}</span></h2>
                    <div className="section-tools">
                      {list.every((c) => selected.has(c.id)) ? (
                        <button type="button" className="link on" onClick={() => setSelected((x) => { const n = new Set(x); list.forEach((c) => n.delete(c.id)); return n; })}>Deselect all</button>
                      ) : (
                        <button type="button" className="link" onClick={() => setSelected((x) => new Set([...x, ...list.map((c) => c.id)]))}>Select all</button>
                      )}
                    </div>
                  </header>
                  <div className={`grid grid-${s.variant}`}>{shown.map((c) => renderTile(c, s.variant))}</div>
                  {list.length > shown.length ? (
                    <div className="more-row">
                      <Button small variant="primary" onClick={() => setLimits((l) => ({ ...l, [s.key]: limit + s.step }))}>Load {Math.min(s.step, list.length - shown.length)} more</Button>
                      <Button small onClick={() => setLimits((l) => ({ ...l, [s.key]: list.length }))}>Show all {list.length}</Button>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {nothing ? (
              <div className="empty">
                {running && webTotal === 0 ? (
                  <><strong>Scanning…</strong><span>Results appear here as they are found.</span></>
                ) : webTotal > 0 ? (
                  <>
                    <strong>Nothing matches</strong>
                    <span>Your search or filter hides everything.</span>
                    <Button small onClick={() => { setFilters({ ...DEFAULT_FILTERS, showSmall: true }); setView('all'); }}>Clear filters</Button>
                  </>
                ) : (
                  <>
                    <strong>{scan.sources.length > 0 && scan.sources.every((s) => s.warning?.code === 'BLOCKED_BY_SITE' && s.count === 0) ? 'This site blocks automated tools' : 'No images found'}</strong>
                    <span>{scan.sources.length > 0 && scan.sources.every((s) => s.warning?.code === 'BLOCKED_BY_SITE' && s.count === 0)
                      ? 'Its firewall refuses requests from tools like GRAB, so nothing can be read. Deep scan will not help. Ask the site owner to allow GRAB, or save the images from your browser.'
                      : serverDeep ? 'The page may build its images with JavaScript. Try again with deep scan on.' : 'The page may build its images with JavaScript, or the site blocks tools. Try another link.'}</span>
                  </>
                )}
              </div>
            ) : null}
        </>
        <div className="spacer" />
      </div>

      {op ? (
        <div className="opbar" role="status">
          <Progress value={op.progress.done} max={op.progress.total} label={`${op.label} ${op.progress.done}/${op.progress.total}${op.progress.failed ? ` · ${op.progress.failed} failed` : ''}`} />
          <Button small variant="danger" icon="close" onClick={() => abort.current?.abort()}>Cancel</Button>
        </div>
      ) : summary ? (
        <SummaryBar s={summary} byId={byId} onClose={() => setSummary(null)} />
      ) : null}

      <div className="actionbar">
        <div className="sel">
          <strong>{selected.size}</strong> selected
          {filtered.length > 0 && filtered.every((c) => selected.has(c.id)) ? (
            <button type="button" className="link on" onClick={clearSelection}>Deselect all ({filtered.length})</button>
          ) : (
            <button type="button" className="link" onClick={selectAllVisible} disabled={filtered.length === 0}>Select all ({filtered.length})</button>
          )}
          <button type="button" className="link" onClick={clearSelection} disabled={selected.size === 0}>Clear</button>
        </div>
        <div className="acts">
          <Button small variant="quiet" icon="link" disabled={selected.size === 0 || !!op} onClick={copySelected}>Copy</Button>
          <Button small icon="download" disabled={selected.size === 0 || !!op} onClick={() => void runDownload(selectedItems)}>{selected.size > 1 ? 'ZIP' : 'Save'}</Button>
          <Button variant="primary" small icon="insert" disabled={selected.size === 0 || !!op} onClick={() => void runInsert(selectedItems)}>Add to Figma{selected.size ? ` (${selected.size})` : ''}</Button>
        </div>
      </div>
      {viewing !== null && viewing >= 0 && filtered[viewing] ? (
        <Lightbox
          items={filtered}
          index={viewing}
          previewUrl={largePreview}
          measured={measured}
          selected={selected}
          busy={busyIds.has(filtered[viewing].id)}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onToggle={toggle}
          onDownload={onDownload}
          onInsert={onInsertOne}
          onCopy={onCopy}
          onOpen={onOpen}
        />
      ) : null}
    </div>
  );
}

function SummaryBar({ s, byId, onClose }: { s: Summary; byId: Map<string, Candidate>; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`summary ${s.ok ? 'ok' : 'warn'}`} role="status">
      <div className="summary-head">
        <Icon name={s.ok ? 'check' : 'close'} size={16} />
        <span>{s.title}</span>
        {s.failures.length ? <button type="button" className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Details'}</button> : null}
        {s.retry ? <Button small icon="retry" onClick={s.retry}>Retry failed</Button> : null}
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      {open ? (
        <ul className="fail-list">
          {s.failures.map((f) => <li key={f.id}><code>{byId.get(f.id) ? pageLabel(byId.get(f.id)!.url) : f.id}</code> {f.reason}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
