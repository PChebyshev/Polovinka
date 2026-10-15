import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { shareText, type ShareResult } from '../lib/share';
import { recommendVariants } from '../lib/recommendText';
import { Button, Card, Chip, Label, Spinner } from '../components/ui';

type RefLink = { url: string; host: string; image: string; title: string; description: string };

/** «Посоветовать друзьям»: готовый текст, предпросмотр сообщения и ссылка на страницу «… советуют вам Половинку». */
export function Recommend() {
  const { me } = useStore();
  const [link, setLink] = useState<RefLink | null>(null);
  const [err, setErr] = useState(false);
  const variants = useMemo(() => (me ? recommendVariants(me) : []), [me]);
  const [variant, setVariant] = useState('warm');
  const [text, setText] = useState('');
  const [state, setState] = useState<ShareResult | 'link' | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // Поле растёт под текст, чтобы пузырь выглядел как настоящее сообщение
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    api
      .recommend()
      .then(setLink)
      .catch(() => setErr(true));
  }, []);

  useEffect(() => {
    const v = variants.find((x) => x.key === variant);
    if (v) setText(v.text);
  }, [variant, variants]);

  if (!me) return null;

  const message = link ? `${text.trim()}\n\n${link.url}` : '';

  const send = async () => {
    if (!link) return;
    const r = await shareText(message);
    setState(r);
    if (r === 'shared' || r === 'copied') void api.recommendSent(r, variant);
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setState('link');
      void api.recommendSent('link', 'link');
    } catch {
      setState('manual');
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Посоветовать друзьям</h1>
      <p className="mt-1 text-sm text-muted">
        Отправьте паре, которой может понравиться. По ссылке друзья увидят, что это от вас, и короткое объяснение, как всё устроено. В вашу пару они не попадут
        — у них будет своя.
      </p>

      <div className="mt-4">
        <Label>Текст сообщения</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {variants.map((v) => (
            <Chip key={v.key} active={variant === v.key} onClick={() => setVariant(v.key)}>
              {v.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-3xl bg-surface-2/60 p-3">
        <div className="mb-2 text-center text-[11px] text-muted">Так сообщение увидят друзья · текст можно поправить</div>
        <div className="ml-auto max-w-[92%] overflow-hidden rounded-3xl rounded-br-lg bg-accent/15 ring-1 ring-accent/25">
          <textarea
            className="block w-full resize-none overflow-hidden bg-transparent px-4 pt-3 text-[15px] leading-snug outline-none"
            ref={area}
            rows={3}
            maxLength={600}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Текст сообщения"
          />
          {link ? (
            <>
              <div className="px-4 pb-2 text-[15px] text-accent-soft underline decoration-accent/40 [overflow-wrap:anywhere]">{link.url}</div>
              <div className="mx-3 mb-3 overflow-hidden rounded-2xl border-l-4 border-accent bg-bg/50">
                <img src={link.image} alt="" className="block aspect-[1200/630] w-full object-cover" />
                <div className="px-3 py-2">
                  <div className="text-xs text-accent">{link.host}</div>
                  <div className="text-sm font-semibold leading-snug">{link.title}</div>
                  <div className="mt-0.5 text-xs leading-snug text-muted">{link.description}</div>
                </div>
              </div>
            </>
          ) : err ? (
            <div className="px-4 pb-3 text-sm text-rose">Не удалось получить ссылку. Проверьте связь.</div>
          ) : (
            <div className="pb-3">
              <Spinner />
            </div>
          )}
        </div>
      </div>

      <Button className="mt-4 w-full" big onClick={send} disabled={!link || !text.trim()}>
        Отправить
      </Button>
      {state === 'shared' && <p className="mt-2 text-center text-sm text-sage">Отправлено. Спасибо, что делитесь ♥</p>}
      {state === 'copied' && <p className="mt-2 text-center text-sm text-sage">Сообщение скопировано — вставьте его в чат</p>}
      {state === 'link' && <p className="mt-2 text-center text-sm text-sage">Ссылка скопирована</p>}
      {state === 'manual' && (
        <textarea readOnly className="mt-3 w-full rounded-2xl bg-surface-2 p-3 text-sm" rows={6} value={message} onFocus={(e) => e.currentTarget.select()} />
      )}
      <Button variant="ghost" className="mt-1 w-full" onClick={copyLink} disabled={!link}>
        Скопировать только ссылку
      </Button>

      <Card className="mt-4">
        <Label>Как лучше отправить</Label>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>• Личным сообщением одной-двум парам, а не в общий чат — так это совет, а не реклама.</li>
          <li>• Можно отправить одному из пары: он сам позовёт половинку из приложения.</li>
          <li>• Друзья откроют ссылку, установят Половинку на экран и начнут свою историю.</li>
        </ul>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Link to="/challenge" className="rounded-2xl border border-line bg-surface px-4 py-3">
          <span className="block font-semibold">Вызов паре</span>
          <span className="block text-xs text-muted">5 ваших вопросов для друзей</span>
        </Link>
        <Link to="/week" className="rounded-2xl border border-line bg-surface px-4 py-3">
          <span className="block font-semibold">Итог недели</span>
          <span className="block text-xs text-muted">Карточка для сторис</span>
        </Link>
      </div>
    </div>
  );
}
