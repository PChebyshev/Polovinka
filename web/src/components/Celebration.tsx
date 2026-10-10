import type { Celebration as C } from '@polovinka/shared';
import { Button, Confetti, Heart } from './ui';

export function CelebrationOverlay({ c, pairTitle, onClose }: { c: C; pairTitle: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 px-6">
      <Confetti count={36} />
      <div className="w-full max-w-sm text-center">
        <div className="pop mx-auto text-accent">
          <Heart className="h-20 w-20" />
        </div>
        <div className="rise-2 mt-4 text-sm uppercase tracking-wider text-muted">{pairTitle}</div>
        <h2 className="rise-2 mt-2 text-3xl font-bold leading-tight">{c.title}</h2>
        <p className="rise-3 mt-3 text-muted">{c.subtitle}</p>
        <Button className="rise-3 mt-8 w-full" big onClick={onClose}>
          Дальше
        </Button>
      </div>
    </div>
  );
}
