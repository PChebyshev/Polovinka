import type { GesturePublic } from '@polovinka/shared';
import { GESTURE_LABELS } from '@polovinka/shared';
import { Button, Card, Heart, Label } from './ui';

export function GestureCard({ gesture, fromName, onSeen }: { gesture: GesturePublic; fromName: string; onSeen: () => void }) {
  const tone = gesture.type === 'proud' ? 'sage' : gesture.type === 'thanks' ? 'accent' : 'rose';
  return (
    <Card tone={tone} className="pop">
      <div className="flex items-center justify-between">
        <Label>{fromName} · тебе</Label>
        <Heart className="h-5 w-5 text-rose" />
      </div>
      <div className="mt-2 text-sm text-muted">{GESTURE_LABELS[gesture.type]}</div>
      <p className="mt-1 text-xl font-semibold leading-snug">{gesture.text}</p>
      <Button variant="secondary" className="mt-4 w-full" onClick={onSeen}>
        ♥ Спасибо
      </Button>
    </Card>
  );
}
