import type { Settings as S } from '../../shared/messages';
import { Button, Icon } from './Bits';

interface Props {
  settings: S;
  setSettings: (patch: Partial<S>) => void;
  onClose: () => void;
  onClearHistory: () => void;
}

export function SettingsPanel({ settings, setSettings, onClose, onClearHistory }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="panel">
        <div className="panel-head">
          <strong>Settings</strong>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

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
