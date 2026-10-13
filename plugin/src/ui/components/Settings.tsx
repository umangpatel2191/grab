import { useState } from 'react';
import type { HealthResponse } from '../../../../shared/types';
import type { Settings as S } from '../../shared/messages';
import { ApiClient, ApiFailure, normalizeBackend } from '../api';
import { Badge, Button, Icon } from './Bits';

interface Props {
  settings: S;
  setSettings: (patch: Partial<S>) => void;
  onClose: () => void;
  onClearHistory: () => void;
}

export function SettingsPanel({ settings, setSettings, onClose, onClearHistory }: Props) {
  const [backend, setBackend] = useState(settings.backend);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; text?: string; health?: HealthResponse }>({ state: 'idle' });
  const normalized = normalizeBackend(backend);

  const runTest = async () => {
    if (!normalized) return setTest({ state: 'fail', text: 'That is not a valid address.' });
    setTest({ state: 'testing' });
    try {
      const health = await new ApiClient(normalized).health(10000);
      setTest({ state: 'ok', health });
      setSettings({ backend: normalized });
      setBackend(normalized);
    } catch (err) {
      const msg = err instanceof ApiFailure ? err.message : 'Could not reach the server.';
      setTest({ state: 'fail', text: `${msg} The address must also be listed under networkAccess in the plugin manifest.` });
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="panel">
        <div className="panel-head">
          <strong>Settings</strong>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        <label className="label" htmlFor="backend">Server address</label>
        <div className="row">
          <input id="backend" className="input grow" value={backend} spellCheck={false} onChange={(e) => setBackend(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void runTest()} />
          <Button small onClick={() => void runTest()} disabled={test.state === 'testing'}>{test.state === 'testing' ? 'Testing…' : 'Test and save'}</Button>
        </div>
        {test.state === 'ok' && test.health ? (
          <div className="row wrap">
            <Badge tone="good">Connected v{test.health.version}</Badge>
            <Badge tone={test.health.features.thumbnails ? 'good' : 'accent'}>{test.health.features.thumbnails ? 'Small previews' : 'Full-size previews'}</Badge>
            <Badge tone={test.health.features.deepScan ? 'good' : 'neutral'}>{test.health.features.deepScan ? 'Deep scan on' : 'Deep scan off'}</Badge>
          </div>
        ) : null}
        {test.state === 'fail' ? <div className="error-box" role="alert"><span>{test.text}</span></div> : null}

        <label className="check-row">
          <input type="checkbox" checked={settings.hd} onChange={(e) => setSettings({ hd: e.target.checked })} />
          <span>HD images <small>full-size originals; small images enlarged 2× for Figma and downloads</small></span>
        </label>

        <label className="label" htmlFor="theme">Theme</label>
        <select id="theme" className="input" value={settings.theme} onChange={(e) => setSettings({ theme: e.target.value as S['theme'] })}>
          <option value="auto">Follow Figma</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>

        <div className="row">
          <Button small onClick={onClearHistory}>Clear recent links</Button>
        </div>

        <h3>Privacy</h3>
        <p className="legal">
          GRAB sends the links you paste to its server to find images and videos. Files are fetched only when you download or insert them.
          Recent links are stored only inside Figma on this computer, and you can clear them any time.
        </p>
      </div>
    </div>
  );
}
