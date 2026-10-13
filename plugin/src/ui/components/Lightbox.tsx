import { useEffect, useState } from 'react';
import type { Candidate } from '../../../../shared/types';
import { extLabel, formatBytes, formatDims, isGif, pageLabel, type Measured } from '../lib';
import { loadPreview } from '../previews';
import { Badge, Button, Icon, IconButton } from './Bits';

interface Props {
  items: Candidate[];
  index: number;
  previewUrl: (c: Candidate, w: number) => string;
  measured: Measured;
  selected: Set<string>;
  busy: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onToggle: (id: string) => void;
  onDownload: (c: Candidate) => void;
  onInsert: (c: Candidate) => void;
  onCopy: (c: Candidate) => void;
  onOpen: (c: Candidate) => void;
}

/** Large preview of one item before anything is downloaded. ← → move, Space selects, Esc closes. */
export function Lightbox({ items, index, previewUrl, measured, selected, busy, onIndex, onClose, onToggle, onDownload, onInsert, onCopy, onOpen }: Props) {
  const c = items[index];
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [info, setInfo] = useState<{ w: number | null; h: number | null; bytes: number | null }>({ w: null, h: null, bytes: null });

  useEffect(() => {
    if (!c) return;
    let alive = true;
    setState('loading');
    setSrc(null);
    const hasPreview = c.kind === 'image' || !!c.posterUrl;
    if (!hasPreview) {
      setState('failed');
      return;
    }
    // GIFs come back animated; everything else as a sharp large preview
    loadPreview(previewUrl(c, 1600))
      .then((r) => {
        if (!alive) return;
        setSrc(r.blobUrl);
        setInfo({ w: r.width, h: r.height, bytes: r.bytes });
        setState('ok');
      })
      .catch(() => alive && setState('failed'));
    return () => {
      alive = false;
    };
  }, [c, previewUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === ' ' && c) {
        e.preventDefault();
        onToggle(c.id);
      } else return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, c, onClose, onIndex, onToggle]);

  if (!c) return null;
  const isSel = selected.has(c.id);
  const dims = info.w && info.h ? `${info.w}×${info.h}` : formatDims(c, measured);
  const kind = c.kind === 'video' ? 'Video' : isGif(c) ? 'GIF' : c.origin === 'inline-svg' || extLabel(c) === 'SVG' ? 'SVG' : 'Image';

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Preview ${index + 1} of ${items.length}`} onClick={onClose}>
      <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
        <header className="lightbox-head">
          <span className="lightbox-count">{index + 1} / {items.length}</span>
          <div className="lightbox-badges">
            <Badge>{kind}</Badge>
            {c.role === 'logo' ? <Badge tone="accent">Site logo</Badge> : null}
            {c.originalUrl ? <Badge tone="good">HD original available</Badge> : null}
          </div>
          <IconButton icon="close" label="Close preview" onClick={onClose} />
        </header>

        <div className={`lightbox-stage${kind === 'SVG' ? ' checker' : ''}`}>
          <button type="button" className="lightbox-nav prev" aria-label="Previous" disabled={index === 0} onClick={() => onIndex(index - 1)}>
            <Icon name="back" size={18} />
          </button>
          {src ? <img src={src} alt={c.title ?? ''} draggable={false} /> : null}
          {state === 'loading' ? <span className="tile-note skeleton lightbox-skeleton" aria-hidden="true" /> : null}
          {state === 'failed' ? <span className="lightbox-note">{c.kind === 'video' ? 'No poster for this video. Open it at the source.' : 'Preview is not available.'}</span> : null}
          {c.kind === 'video' ? <span className="pill pill-play lightbox-play"><Icon name="play" size={12} /> Video</span> : null}
          <button type="button" className="lightbox-nav next" aria-label="Next" disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)}>
            <Icon name="next" size={18} />
          </button>
        </div>

        <dl className="lightbox-meta">
          <div><dt>Size</dt><dd>{dims}</dd></div>
          <div><dt>Type</dt><dd>{extLabel(c)}{info.bytes ? ` · ${formatBytes(info.bytes)}` : ''}</dd></div>
          <div><dt>Found on</dt><dd><a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{pageLabel(c.sourceUrl)}</a></dd></div>
          {c.title ? <div className="wide"><dt>Description</dt><dd>{c.title}</dd></div> : null}
        </dl>

        <footer className="lightbox-actions">
          <Button small variant={isSel ? 'primary' : 'plain'} icon="check" onClick={() => onToggle(c.id)}>{isSel ? 'Selected' : 'Select'}</Button>
          <span className="spacer" />
          <IconButton icon="copy" label="Copy link" onClick={() => onCopy(c)} />
          <IconButton icon="open" label="Open original" onClick={() => onOpen(c)} />
          {c.downloadable ? <Button small icon="download" disabled={busy} onClick={() => onDownload(c)}>{busy ? 'Saving…' : 'Download'}</Button> : null}
          <Button small variant="primary" icon="insert" onClick={() => onInsert(c)}>{c.kind === 'video' ? 'Add poster to Figma' : 'Add to Figma'}</Button>
        </footer>
      </div>
    </div>
  );
}
