import { memo, useEffect, useRef, useState } from 'react';
import type { Candidate } from '../../../../shared/types';
import { extLabel, formatBytes, formatDuration, isGif } from '../lib';
import { loadPreview } from '../previews';
import { Icon, IconButton } from './Bits';

export type TileVariant = 'card' | 'icon' | 'square';

interface TileProps {
  c: Candidate;
  variant?: TileVariant;
  previewUrl: string;
  selected: boolean;
  dimsText: string;
  busy: boolean;
  onToggle: (id: string) => void;
  onMeasure: (id: string, w: number, h: number, bytes: number | null) => void;
  onCopy: (c: Candidate) => void;
  onOpen: (c: Candidate) => void;
  onDownload: (c: Candidate) => void;
  onInsert: (c: Candidate) => void;
  onView: (c: Candidate) => void;
}

export const Tile = memo(function Tile({ c, variant = 'card', previewUrl, selected, dimsText, onToggle, onMeasure, onOpen, onInsert, onView }: TileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [bytes, setBytes] = useState<number | null>(c.bytes);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const hasPreview = c.kind === 'image' || !!c.posterUrl;
  useEffect(() => {
    if (!visible || !hasPreview) return;
    let alive = true;
    setState('loading');
    loadPreview(previewUrl)
      .then((r) => {
        if (!alive) return;
        setSrc(r.blobUrl);
        setState('ok');
        setBytes((b) => b ?? r.bytes);
        if (c.kind === 'image' && r.width && r.height && !(c.width && c.height)) onMeasure(c.id, r.width, r.height, r.bytes);
      })
      .catch(() => alive && setState('failed'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, previewUrl, attempt, hasPreview]);

  const isVideo = c.kind === 'video';
  const gif = isGif(c);
  const label = `${isVideo ? 'Video' : gif ? 'GIF' : 'Image'} ${dimsText} ${extLabel(c)}`;
  const size = formatBytes(bytes);

  return (
    <div ref={ref} className={`tile tile-${variant}${selected ? ' is-selected' : ''}`} data-id={c.id}>
      <div className="tile-frame">
        <button type="button" className="tile-media" onClick={() => onToggle(c.id)} aria-pressed={selected} aria-label={`${selected ? 'Deselect' : 'Select'} ${label}`}>
          {src ? <img src={src} alt={c.title ?? ''} draggable={false} /> : null}
          {!src && state === 'failed' ? <span className="tile-note">No preview</span> : null}
          {!src && state !== 'failed' && hasPreview ? <span className="tile-note skeleton" aria-hidden="true" /> : null}
          {!hasPreview ? <span className="tile-note">{isVideo ? 'Video' : 'Image'}</span> : null}
          {isVideo ? (
            <span className="pill pill-play">
              <Icon name="play" size={11} />
              {formatDuration(c.durationSec)}
            </span>
          ) : gif ? (
            <span className="pill">GIF</span>
          ) : null}
          {c.role === 'logo' ? <span className="pill pill-logo">Logo</span> : c.originalUrl ? <span className="pill pill-hd">HD</span> : null}
          <span className={`check${selected ? ' on' : ''}`} aria-hidden="true">
            {selected ? <Icon name="check" size={13} /> : null}
          </span>
        </button>
        <div className="tile-actions">
          {state === 'failed' ? <IconButton icon="retry" label="Retry preview" onClick={() => setAttempt((a) => a + 1)} /> : null}
          <IconButton icon="eye" label="View large" onClick={() => onView(c)} />
          <IconButton icon="insert" label={isVideo ? 'Add poster to Figma' : 'Add to Figma'} onClick={() => onInsert(c)} />
          <IconButton icon="open" label="Open link" onClick={() => onOpen(c)} />
        </div>
      </div>
      {variant === 'card' ? (
        <div className="tile-meta">
          <span>{dimsText}</span>
          <span>{extLabel(c)}{size ? ` · ${size}` : ''}</span>
        </div>
      ) : null}
    </div>
  );
});
