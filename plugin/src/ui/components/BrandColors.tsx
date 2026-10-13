import { useState } from 'react';
import type { BrandColor } from '../../../../shared/types';
import { ROLE_LABEL, copyText } from '../lib';
import { Button } from './Bits';

interface Props {
  colors: BrandColor[];
  onCopy: (hex: string) => void;
  onCopyAll: () => void;
  onInsert: () => Promise<void>;
}

export function BrandColors({ colors, onCopy, onCopyAll, onInsert }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="section" aria-label="Brand colors">
      <header className="section-head">
        <h2>Brand colors <span className="count">{colors.length}</span></h2>
        <div className="section-tools">
          <button type="button" className="link" onClick={onCopyAll}>Copy all</button>
          <Button
            small
            icon="palette"
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
      <div className="swatches">
        {colors.map((c) => (
          <button key={c.hex} type="button" className="swatch" onClick={() => onCopy(c.hex)} title={`Copy ${c.hex} · from ${c.source}`} aria-label={`Copy ${c.hex}, ${ROLE_LABEL[c.role]} color`}>
            <span className="swatch-chip" style={{ background: c.hex }} />
            <span className="swatch-hex">{c.hex}</span>
            <span className="swatch-role">{ROLE_LABEL[c.role]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export { copyText };
