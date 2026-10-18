import { useEffect, useMemo, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'choice';

export function Button({
  variant = 'primary',
  big = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 select-none';
  const size = big ? 'min-h-16 px-6 text-lg' : 'min-h-13 px-5 text-base';
  const look: Record<Variant, string> = {
    primary: 'bg-accent text-bg shadow-[0_8px_24px_-8px_rgba(255,127,156,0.5)] hover:bg-accent-soft',
    secondary: 'bg-surface-2 text-text border border-line hover:border-muted/50',
    ghost: 'bg-transparent text-muted hover:text-text',
    choice: 'bg-surface border-2 border-line text-text text-lg min-h-20 px-5 text-left leading-snug hover:border-accent/60',
  };
  return (
    <button className={`${base} ${size} ${look[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  tone = 'surface',
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'surface' | 'accent' | 'sage' | 'rose';
  id?: string;
}) {
  const tones = {
    surface: 'bg-surface border border-line',
    accent: 'bg-gradient-to-br from-accent/20 to-sand/10 border border-accent/30',
    sage: 'bg-gradient-to-br from-sage/20 to-sage/5 border border-sage/30',
    rose: 'bg-gradient-to-br from-rose/20 to-rose/5 border border-rose/30',
  };
  return (
    <div id={id} className={`rounded-3xl p-5 ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function Chip({ active = false, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={`rounded-full px-4 py-2.5 text-sm border transition active:scale-95 ${
        active ? 'bg-accent text-bg border-accent' : 'bg-surface-2 border-line text-text hover:border-muted/60'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Label({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`text-xs uppercase tracking-wider text-muted ${className}`}>
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-line border-t-accent animate-spin" />
    </div>
  );
}

export function Heart({ className = 'h-6 w-6', filled = true }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 2} aria-hidden>
      <path d="M12 21s-6.7-4.3-9.3-8.1C.6 9.8 1.6 5.6 5.1 4.3c2.1-.8 4.4-.1 5.9 1.6l1 1.1 1-1.1c1.5-1.7 3.8-2.4 5.9-1.6 3.5 1.3 4.5 5.5 2.4 8.6C18.7 16.7 12 21 12 21z" />
    </svg>
  );
}

export function Confetti({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i / count) * 100 + Math.random() * 4}%`,
        dx: `${(Math.random() - 0.5) * 120}px`,
        dur: `${2.2 + Math.random() * 1.6}s`,
        delay: `${Math.random() * 0.6}s`,
        color: ['#ff7f9c', '#ffc59e', '#b69cff', '#e879c6', '#fbf0f6'][i % 5],
        rotate: `${Math.random() * 90}deg`,
      })),
    [count],
  );
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: p.left,
            background: p.color,
            transform: `rotate(${p.rotate})`,
            ['--dx' as string]: p.dx,
            ['--dur' as string]: p.dur,
            ['--delay' as string]: p.delay,
          }}
        />
      ))}
    </>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface border-t border-line p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        {title && <h3 className="mb-3 text-lg font-semibold">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
