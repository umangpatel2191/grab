import { useState } from 'react';
import { COFFEE_URL, SUPPORT_EMAIL, copyText } from '../lib';
import { Icon } from './Bits';

export function HelpPanel({ onClose, onToast }: { onClose: () => void; onToast: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Help">
      <div className="panel">
        <div className="panel-head">
          <strong>Help</strong>
          <button type="button" className="icon-btn" aria-label="Close help" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        <h3>How it works</h3>
        <ol className="how">
          <li>Paste one or more website links and press Fetch.</li>
          <li>Browse brand colors, images, icons, GIFs and videos. Nothing downloads until you choose.</li>
          <li>Hover a picture to view it large, add it to Figma, or open its link. Select several to Save, ZIP or Add to Figma.</li>
          <li>Create Brand Book builds brand guidelines in Figma; Export tokens saves design tokens for developers.</li>
          <li>Your last scan stays until you start a new one.</li>
        </ol>

        <h3>Good to know</h3>
        <ul className="how">
          <li>Click a color to copy it. “Add to Figma” makes swatches and color styles.</li>
          <li>Video files up to 50 MB can be saved. Streams and embeds open at the source; Figma gets the poster image.</li>
          <li>Pages behind a login cannot be read. Sites that show a bot check to browsers fall back to the normal scan.</li>
          <li>Pages that build their images with JavaScript are rendered in a browser automatically when the server can.</li>
        </ul>

        <h3>Shortcuts</h3>
        <p className="legal"><kbd>⌘/Ctrl ↵</kbd> fetch · <kbd>/</kbd> search · <kbd>A</kbd> select all · <kbd>D</kbd> download · <kbd>I</kbd> insert · <kbd>Esc</kbd> clear</p>

        <a className="coffee-card" href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
          <span className="coffee-card-icon"><Icon name="coffee" size={22} /></span>
          <span className="coffee-card-text">
            <strong>Enjoying GRAB?</strong>
            <span>It is free and made by one designer. A coffee keeps the server running and new features coming.</span>
          </span>
          <span className="coffee-card-cta">Buy me a coffee</span>
        </a>

        <h3>Guide and privacy</h3>
        <p className="legal">
          <a className="link" href="https://github.com/umangpatel2191/grab/blob/main/docs/USER-GUIDE.md" target="_blank" rel="noopener noreferrer">User guide</a>
          {'  ·  '}
          <a className="link" href="https://github.com/umangpatel2191/grab/blob/main/docs/PRIVACY.md" target="_blank" rel="noopener noreferrer">Privacy policy</a>
        </p>

        <h3>Contact</h3>
        <p className="legal">Questions, bugs or ideas? Email us.</p>
        <div className="mail">
          <a className="mail-link" href={`mailto:${SUPPORT_EMAIL}?subject=GRAB%20Figma%20plugin`} target="_blank" rel="noopener noreferrer"><Icon name="mail" size={15} />{SUPPORT_EMAIL}</a>
          <button
            type="button"
            className="btn btn-plain btn-small"
            onClick={async () => {
              const ok = await copyText(SUPPORT_EMAIL);
              setCopied(ok);
              onToast(ok ? 'Email address copied' : 'Could not copy');
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="legal">Images and video belong to their owners. Make sure you have the right to use anything you download or insert.</p>
      </div>
    </div>
  );
}
