import { useId, type ReactNode } from 'react';
import { LEVEL_INFO, STREAK_MILESTONES, topicOf } from '@polovinka/shared';

/**
 * Визуальные значки: медали тем, эмблемы уровней, медали серии.
 * Всё — инлайн-SVG на цветах темы, без картинок и шрифтов-иконок.
 */

type Tier = 'locked' | 'none' | 'explored' | 'know';

/** Иконки тем: контурные, 24×24, рисуются currentColor. */
const TOPIC_ICON: Record<string, ReactNode> = {
  food: (
    <>
      <path d="M5 3v7a3 3 0 0 0 3 3v8M8 3v6M11 3v6" />
      <path d="M18 3c-2 1-3 4-3 7v2h3v9" />
    </>
  ),
  rest: (
    <>
      <path d="M3 20h18" />
      <path d="M4 20 12 5l8 15" />
      <path d="M12 5v15" />
      <path d="M8.5 20 12 13l3.5 7" />
    </>
  ),
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  weird: (
    <>
      <ellipse cx="12" cy="13" rx="9" ry="3" />
      <path d="M7.5 11.5C8 8.5 9.8 7 12 7s4 1.5 4.5 4.5" />
      <path d="M12 16v2M8 15.5l-1 2M16 15.5l1 2" />
    </>
  ),
  whatif: (
    <>
      <path d="M7 16a5 5 0 0 1-2-9.6A6 6 0 0 1 16.5 6 4 4 0 0 1 18 14H7Z" />
      <path d="M6 19.5h.01M4 21.5h.01" />
      <path d="M10.5 9.5a1.8 1.8 0 1 1 2.5 1.6c-.6.3-.9.7-.9 1.3M12.1 14.5h.01" />
    </>
  ),
  memories: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7l1.5-3h5L16 7" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  habits: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  joy: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  dreams: (
    <>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      <path d="M17 3v4M15 5h4" />
    </>
  ),
  values: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    </>
  ),
  childhood: (
    <>
      <path d="M12 3c-3.3 0-5.5 2.6-5.5 6 0 3.6 3 6.5 5.5 6.5s5.5-2.9 5.5-6.5c0-3.4-2.2-6-5.5-6Z" />
      <path d="M12 15.5c-1 2 1 3 0 5.5" />
      <path d="M9.5 7.5c.3-1 1-1.6 2-1.8" />
    </>
  ),
  future: (
    <>
      <path d="M12 2c3 2 4.5 6 4.5 10l-1.5 3h-6L7.5 12C7.5 8 9 4 12 2Z" />
      <path d="M7.5 12 4 15l3 1M16.5 12 20 15l-3 1" />
      <path d="M10 18c0 2 1 3 2 4 1-1 2-2 2-4" />
      <circle cx="12" cy="10" r="1.6" />
    </>
  ),
  again: (
    <>
      <path d="M12 12c-2-3-3.5-4.5-5.5-4.5a4.5 4.5 0 0 0 0 9c2 0 3.5-1.5 5.5-4.5s3.5-4.5 5.5-4.5a4.5 4.5 0 0 1 0 9c-2 0-3.5-1.5-5.5-4.5Z" />
    </>
  ),
};

function TopicGlyph({ topic }: { topic: string }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {TOPIC_ICON[topic] ?? <circle cx="12" cy="12" r="6" />}
    </g>
  );
}

/** Маленькая звёздочка для второго значка темы. */
function Star({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`);
  }
  return <polygon points={pts.join(' ')} fill={fill} />;
}

/**
 * Медаль темы.
 *  none      — тёмный диск с контурной иконкой: значок ещё не получен
 *  explored  — лиловая медаль: «исследовали» (5 раскрытых вопросов)
 *  know      — золотая медаль с лавром и звездой: «знаем друг друга»
 *  locked    — пунктирный контур, тема ещё закрыта уровнем
 */
export function TopicMedal({ topic, tier, size = 56, className = '' }: { topic: string; tier: Tier; size?: number; className?: string }) {
  const id = useId();
  const grad = `g${id}`;
  const title = topicOf(topic)?.label ?? topic;
  const earned = tier === 'explored' || tier === 'know';
  const gold = tier === 'know';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={`${title}: ${TIER_LABEL[tier]}`}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          {gold ? (
            <>
              <stop offset="0" stopColor="#ffe3bf" />
              <stop offset="0.55" stopColor="var(--color-sand)" />
              <stop offset="1" stopColor="#d9915e" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#d4c3ff" />
              <stop offset="0.55" stopColor="var(--color-lilac)" />
              <stop offset="1" stopColor="#7a5fd1" />
            </>
          )}
        </linearGradient>
      </defs>

      {/* бусинный ободок у золотой медали */}
      {gold && (
        <circle
          cx="32"
          cy="32"
          r="27.5"
          fill="none"
          stroke="var(--color-sand)"
          strokeWidth={3}
          strokeDasharray="1.2 3.1"
          strokeLinecap="round"
          opacity={0.95}
        />
      )}
      {/* кольцо */}
      <circle
        cx="32"
        cy="32"
        r={gold ? 22 : 27}
        fill="none"
        stroke={earned ? (gold ? '#ffe3bf' : '#d4c3ff') : 'var(--color-line)'}
        strokeWidth={earned ? 2 : 1.5}
        strokeDasharray={tier === 'locked' ? '3 3' : undefined}
        opacity={earned ? 0.9 : 1}
      />
      {/* диск */}
      <circle cx="32" cy="32" r={gold ? 19 : 23} fill={earned ? `url(#${grad})` : 'var(--color-surface-2)'} />
      {earned && <circle cx="26" cy="25" r={gold ? 7 : 9} fill="#fff" opacity={0.18} />}

      <g
        transform={gold ? 'translate(21.5 21.5) scale(0.875)' : 'translate(19.5 19.5) scale(1.04)'}
        color={earned ? 'var(--color-bg)' : tier === 'locked' ? 'var(--color-line)' : 'var(--color-muted)'}
      >
        <TopicGlyph topic={topic} />
      </g>

      {gold && <Star x={32} y={8.5} r={5} fill="var(--color-sand)" />}
    </svg>
  );
}

const TIER_LABEL: Record<Tier, string> = {
  locked: 'тема закрыта',
  none: 'значка пока нет',
  explored: 'исследовали',
  know: 'знаем друг друга',
};

/** Сердце, общее для эмблем. */
function HeartPath({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 8.5 -7.6 1.1A4.6 4.6 0 0 1 0 -5.2a4.6 4.6 0 0 1 7.6 6.3Z" fill={fill} />;
}

/** Цвет уровня: 1–2 лиловый контур, 3–4 лиловая, 5–6 розовая, 7–8 золотая. */
function levelTone(level: number): {
  from: string;
  mid: string;
  to: string;
  ink: string;
} {
  if (level >= 7)
    return {
      from: '#ffe3bf',
      mid: 'var(--color-sand)',
      to: '#d9915e',
      ink: 'var(--color-bg)',
    };
  if (level >= 5)
    return {
      from: '#ffc2d0',
      mid: 'var(--color-accent)',
      to: '#d94f74',
      ink: 'var(--color-bg)',
    };
  if (level >= 3)
    return {
      from: '#d4c3ff',
      mid: 'var(--color-lilac)',
      to: '#7a5fd1',
      ink: 'var(--color-bg)',
    };
  return {
    from: 'var(--color-surface-2)',
    mid: 'var(--color-surface-2)',
    to: 'var(--color-surface)',
    ink: 'var(--color-lilac)',
  };
}

/** Эмблема уровня: щит с сердцем и номером. Пройденные — цветные, будущие — контур. */
export function LevelEmblem({ level, reached, size = 56, className = '' }: { level: number; reached: boolean; size?: number; className?: string }) {
  const id = useId();
  const grad = `g${id}`;
  const tone = levelTone(level);
  const name = LEVEL_INFO[level - 1]?.name ?? '';
  const shield = 'M32 4 54 13v19c0 14-10 23-22 28C20 55 10 46 10 32V13Z';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={`Уровень ${level} · ${name}${reached ? '' : ' (ещё не открыт)'}`}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone.from} />
          <stop offset="0.5" stopColor={tone.mid} />
          <stop offset="1" stopColor={tone.to} />
        </linearGradient>
      </defs>
      <path
        d={shield}
        fill={reached ? `url(#${grad})` : 'var(--color-surface)'}
        stroke={reached ? tone.from : 'var(--color-line)'}
        strokeWidth={reached ? 1.5 : 1.5}
        strokeDasharray={reached ? undefined : '3 3'}
        strokeLinejoin="round"
      />
      {reached && <circle cx="23" cy="19" r="8" fill="#fff" opacity={0.14} />}
      <HeartPath x={32} y={19} s={1.05} fill={reached ? tone.ink : 'var(--color-line)'} />
      <text
        x="32"
        y="51"
        textAnchor="middle"
        fontSize="20"
        fontWeight={800}
        fill={reached ? tone.ink : 'var(--color-muted)'}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {level}
      </text>
      {/* звёзды на высоких уровнях */}
      {reached && level >= 5 && <Star x={16} y={40} r={3.2} fill={tone.ink} />}
      {reached && level >= 5 && <Star x={48} y={40} r={3.2} fill={tone.ink} />}
      {reached && level >= 7 && <Star x={32} y={57} r={3.2} fill={tone.ink} />}
    </svg>
  );
}

/** Медаль серии: пламя и число дней. 7 — лиловая, 30 — розовая, 100 — золотая. */
export function StreakMedal({ days, reached, size = 56, className = '' }: { days: number; reached: boolean; size?: number; className?: string }) {
  const id = useId();
  const grad = `g${id}`;
  const idx = STREAK_MILESTONES.indexOf(days);
  const tone = levelTone(idx <= 0 ? 3 : idx === 1 ? 5 : 7);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={`${days} дней подряд${reached ? '' : ' (ещё впереди)'}`}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone.from} />
          <stop offset="0.5" stopColor={tone.mid} />
          <stop offset="1" stopColor={tone.to} />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="27"
        fill="none"
        stroke={reached ? tone.from : 'var(--color-line)'}
        strokeWidth={reached ? 2 : 1.5}
        strokeDasharray={reached ? undefined : '3 3'}
        opacity={0.9}
      />
      <circle cx="32" cy="32" r="23" fill={reached ? `url(#${grad})` : 'var(--color-surface-2)'} />
      {reached && <circle cx="26" cy="25" r="9" fill="#fff" opacity={0.18} />}
      <path
        transform="translate(20 10) scale(1.0)"
        d="M12 2c1 3.5-1.5 5.3-1.5 8 0 1.4 1 2.5 2.3 2.5 1.6 0 2.4-1.3 2.2-3.3 2.4 1.7 4 4.3 4 7.1C19 20.4 15.9 23 12 23s-7-2.6-7-6.7C5 10.6 10.4 7.6 12 2z"
        fill={reached ? tone.ink : 'var(--color-muted)'}
        opacity={reached ? 0.9 : 0.6}
      />
      <text x="32" y="47" textAnchor="middle" fontSize={days >= 100 ? 12 : 13} fontWeight={800} fill={reached ? tone.ink : 'var(--color-muted)'}>
        {days}
      </text>
    </svg>
  );
}

/** Значок для ключа вехи: b:food:e, l3, s30. Для остальных — null. */
export function badgeForKey(key: string, size = 96): ReactNode {
  const b = key.match(/^b:([a-z]+):([ek])$/);
  if (b) return <TopicMedal topic={b[1]} tier={b[2] === 'k' ? 'know' : 'explored'} size={size} />;
  const l = key.match(/^l(\d+)$/);
  if (l) return <LevelEmblem level={Number(l[1])} reached size={size} />;
  const s = key.match(/^s(\d+)$/);
  if (s) return <StreakMedal days={Number(s[1])} reached size={size} />;
  return null;
}
