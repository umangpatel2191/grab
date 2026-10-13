import { useState } from 'react';
import { SUPPORT_EMAIL, copyText } from '../lib';
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
          <li>Select what you want, then Insert into Figma, Save, or make a ZIP.</li>
          <li>Pick how many pages of each site to read. GRAB follows the menu, footer and sitemap and shows each picture once.</li>
        </ol>

        <h3>Good to know</h3>
        <ul className="how">
          <li>Click a color to copy it. “Add to Figma” makes swatches and color styles.</li>
          <li>Video files up to 50 MB can be saved. Streams and embeds open at the source; Figma gets the poster image.</li>
          <li>Pages behind a login cannot be read. Sites that show a bot check to browsers fall back to the normal scan.</li>
          <li>Pages that build their images with JavaScript are rendered in a browser automatically; Deep scan does this for every page.</li>
        </ul>

        <h3>Shortcuts</h3>
        <p className="legal"><kbd>⌘/Ctrl ↵</kbd> fetch · <kbd>/</kbd> search · <kbd>A</kbd> select all · <kbd>D</kbd> download · <kbd>I</kbd> insert · <kbd>Esc</kbd> clear</p>

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
