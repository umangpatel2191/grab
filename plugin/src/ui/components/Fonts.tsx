import { useState } from 'react';
import type { FontInfo } from '../../../../shared/types';
import { Badge, Button } from './Bits';

interface Props {
  fonts: FontInfo[];
  onCopy: (text: string) => void;
  onInsert: () => Promise<void>;
}

const ROLE: Record<string, string> = { heading: 'Headings', body: 'Body text', button: 'Buttons', other: 'Used' };
const SOURCE: Record<FontInfo['source'], string> = { google: 'Google Fonts', adobe: 'Adobe Fonts', 'self-hosted': 'Self-hosted', system: 'System font' };

export function Fonts({ fonts, onCopy, onInsert }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="section" aria-label="Fonts">
      <header className="section-head">
        <h2>Fonts <span className="count">{fonts.length}</span></h2>
        <div className="section-tools">
          <button type="button" className="link" onClick={() => onCopy(fonts.map((f) => f.family).join(', '))}>Copy all</button>
          <Button
            small
            icon="insert"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onInsert();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Adding…' : 'Add to Figma'}
          </Button>
        </div>
      </header>
      <ul className="fonts">
        {fonts.map((f) => (
          <li key={f.family} className="font-row">
            <button type="button" className="font-name" onClick={() => onCopy(f.family)} title={`Copy “${f.family}”`}>
              {f.family}
            </button>
            <div className="font-meta">
              <span>{f.roles.map((r) => ROLE[r]).join(' · ')}</span>
              {f.weights.length ? <span>{f.weights.slice(0, 6).join(', ')}</span> : null}
              <Badge tone={f.source === 'google' ? 'good' : 'neutral'}>{SOURCE[f.source]}</Badge>
              {f.source === 'google' ? (
                <a className="link" href={`https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, '+')}`} target="_blank" rel="noopener noreferrer">
                  View
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
