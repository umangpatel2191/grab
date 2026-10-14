import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HealthResponse } from '../../../shared/types';
import { DEFAULT_SETTINGS, type HistoryEntry, type Settings } from '../shared/messages';
import { ApiClient, ApiFailure } from './api';
import { onMain, sendToMain } from './bridge';
import { Button, IconButton, Logo } from './components/Bits';
import { Home, type ServerStatus } from './components/Home';
import { Results } from './components/Results';
import { HelpPanel } from './components/Help';
import { SettingsPanel } from './components/Settings';
import { clearPreviews } from './previews';
import { useScan } from './scan';

interface ToastMsg {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

export function App() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [server, setServer] = useState<ServerStatus>({ state: 'checking', health: null });
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ---- storage (kept by Figma, not the browser)
  useEffect(() => {
    const off = onMain((m) => {
      if (m.type !== 'storage:data') return;
      if (m.settings) setSettingsState({ ...DEFAULT_SETTINGS, ...m.settings });
      if (m.history) setHistory(m.history);
      setLoaded(true);
    });
    sendToMain({ type: 'storage:get' });
    const fallback = setTimeout(() => setLoaded(true), 1500); // never block on storage
    return () => {
      off();
      clearTimeout(fallback);
    };
  }, []);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      sendToMain({ type: 'storage:set', key: 'settings', value: next });
      return next;
    });
  }, []);

  // ---- theme
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // ---- API client
  const getApi = useCallback(() => {
    const c = new ApiClient(settingsRef.current.backend);
    c.hd = settingsRef.current.hd;
    return c;
  }, []);
  const api = useMemo(() => {
    try {
      const c = new ApiClient(settings.backend);
      c.hd = settings.hd;
      return c;
    } catch {
      return null;
    }
  }, [settings.backend, settings.hd]);

  // ---- server status (free servers sleep: wake them in the background)
  useEffect(() => {
    if (!loaded || !api) return;
    const ctl = new AbortController();
    let timer: number | null = null;
    setServer({ state: 'checking', health: null });
    const check = (first: boolean) => {
      api
        .wake((n) => (n > 1 || !first) && setServer({ state: 'waking', health: null, attempt: n }), ctl.signal)
        .then((health: HealthResponse) => {
          setServer({ state: 'up', health });
          // a server that just started checks its browser in the background: ask again shortly
          if (!health.features.deepScan) timer = window.setTimeout(() => api.health(8000).then((h) => !ctl.signal.aborted && setServer({ state: 'up', health: h })).catch(() => undefined), 20000);
        })
        .catch((err) => {
          if (err instanceof ApiFailure && err.code === 'CANCELED') return;
          setServer({ state: 'down', health: null });
          // keep trying on our own: a sleeping free server can take a while
          timer = window.setTimeout(() => check(false), 15000);
        });
    };
    check(true);
    return () => {
      ctl.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [loaded, api]);

  // ---- scanning
  const scanApi = useScan(getApi);
  const { state: scan } = scanApi;

  const toast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 2200);
    if (tone === 'error') sendToMain({ type: 'notify', message: text, error: true });
  }, []);

  const startScan = useCallback(
    (urls: string[]) => {
      clearPreviews();
      setStartedAt(Date.now());
      const entry: HistoryEntry = { urls, at: Date.now() };
      setHistory((h) => {
        const next = [entry, ...h.filter((x) => x.urls.join() !== urls.join())].slice(0, 10);
        sendToMain({ type: 'storage:set', key: 'history', value: next });
        return next;
      });
      void scanApi.start(urls, { deep: settings.deep && !!server.health?.features.deepScan, pages: settings.pages });
    },
    [scanApi, settings.deep, settings.pages, server.health],
  );

  const newScan = useCallback(() => {
    void scanApi.cancel();
    scanApi.reset();
    clearPreviews();
  }, [scanApi]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    sendToMain({ type: 'storage:set', key: 'history', value: [] });
    toast('Recent links cleared');
  }, [toast]);

  // elapsed time while the first request is waiting (cold start message)
  useEffect(() => {
    if (scan.phase !== 'starting') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [scan.phase]);

  const onResultsScreen = scan.phase === 'running' || scan.phase === 'done' || scan.phase === 'canceled';
  const dot = server.state === 'up' ? 'good' : server.state === 'down' ? 'bad' : 'busy';
  const dotText = server.state === 'up' ? 'Server ready' : server.state === 'down' ? 'Server offline' : server.state === 'waking' ? 'Server waking up…' : 'Checking server…';

  return (
    <div className="app">
      <header className="header">
        <Logo size={26} />
        <h1>Grab</h1>
        <span className="grow" />
        <span className={`server${server.state === 'up' ? ' quiet' : ''}`} title={dotText}>
          <span className={`dot ${dot}`} aria-hidden="true" />
          <span className="server-text">{dotText}</span>
        </span>
        <IconButton icon="help" label="Help" onClick={() => setShowHelp(true)} />
        <IconButton icon="gear" label="Settings" onClick={() => setShowSettings(true)} />
      </header>

      <main className="main">
        {!loaded ? (
          <div className="empty"><strong>Loading…</strong></div>
        ) : onResultsScreen && api ? (
          <Results
            scan={scan}
            api={api}
            settings={settings}
            serverDeep={!!server.health?.features.deepScan}
            onNew={newScan}
            onCancel={() => void scanApi.cancel()}
            onToast={toast}
          />
        ) : scan.phase === 'error' && scan.jobId ? (
          <div className="home">
            <div className="error-box" role="alert"><strong>Scan stopped</strong><span>{scan.error?.message}</span></div>
            <Button variant="primary" onClick={newScan}>Back</Button>
          </div>
        ) : (
          <Home
            input={input}
            setInput={setInput}
            settings={settings}
            setSettings={setSettings}
            history={history}
            server={server}
            starting={scan.phase === 'starting'}
            startingFor={scan.phase === 'starting' ? Math.floor((Date.now() - startedAt) / 1000) : 0}
            error={scan.phase === 'error' ? scan.error?.message ?? 'Something went wrong.' : server.state === 'down' ? 'The server is not answering. Check Settings, or try again in a minute.' : null}
            onFetch={startScan}
            onClearHistory={clearHistory}
          />
        )}
      </main>

      {showHelp ? <HelpPanel onClose={() => setShowHelp(false)} onToast={toast} /> : null}
      {showSettings ? <SettingsPanel settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)} onClearHistory={clearHistory} /> : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
      <ResizeHandle />
    </div>
  );
}

function ResizeHandle() {
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => sendToMain({ type: 'resize', width: ev.clientX + 8, height: ev.clientY + 8 });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return <div className="resize" onPointerDown={onDown} role="separator" aria-label="Resize plugin window" title="Drag to resize" />;
}
