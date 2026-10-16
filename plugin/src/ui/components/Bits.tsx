import type { ButtonHTMLAttributes, ReactNode } from 'react';

const ICONS: Record<string, string> = {
  copy: 'M9 9h10v10H9zM5 15V5h10',
  open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  play: 'M8 5l11 7-11 7z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2l.4 2.7h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  help: 'M9.5 9a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2M12 17h.01M12 21a9 9 0 100-18 9 9 0 000 18z',
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  retry: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5',
  insert: 'M12 5v14M5 12h14',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  next: 'M9 5l7 7-7 7',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  coffee: 'M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5zM17 10h1.5a2.5 2.5 0 010 5H17M8 3v2.5M11.5 3v2.5',
  palette: 'M12 3a9 9 0 100 18c1.5 0 2-1 1.6-2-.5-1.2.2-2.5 1.6-2.5H17a4 4 0 004-4c0-5-4-9.5-9-9.5zM7.5 11h.01M10 7.5h.01M14 7.5h.01',
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'plain' | 'danger' | 'quiet'; small?: boolean; icon?: string };

export function Button({ variant = 'plain', small, icon, children, className = '', ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant}${small ? ' btn-small' : ''} ${className}`} {...rest}>
      {icon ? <Icon name={icon} size={small ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'accent' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <span className="progress-text">{label}</span>
    </div>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="GRAB">
      <rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="#16161A" stroke="#fff" strokeOpacity="0.16" />
      <path d="M32 11v21M22.5 23.5L32 33l9.5-9.5" fill="none" stroke="#FFD60A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="40" width="16" height="9" rx="2.5" fill="#F4F1E8" />
      <rect x="34" y="40" width="16" height="9" rx="2.5" fill="#F4F1E8" />
    </svg>
  );
}
