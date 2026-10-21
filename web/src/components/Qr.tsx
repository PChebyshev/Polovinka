import { useMemo } from 'react';
import { encode } from 'uqr';

/** QR-код в SVG: тёмные модули на светлой подложке — так его читает любая камера, и в тёмной теме тоже. */
export function QrCode({ text, size = 220, label }: { text: string; size?: number; label?: string }) {
  const path = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { d, n: data.length };
  }, [text]);
  const quiet = 4;
  const box = path.n + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      role="img"
      aria-label={label ?? 'QR-код'}
      shapeRendering="crispEdges"
      data-qr={text}
      className="rounded-2xl"
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <path d={path.d} fill="#17111f" />
    </svg>
  );
}
