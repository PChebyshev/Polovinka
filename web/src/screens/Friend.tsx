import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { plural } from '../lib/format';
import { Onboarding } from './Onboarding';
import { HowItWorks } from '../components/HowItWorks';
import { Spinner } from '../components/ui';

/** Страница по ссылке «посоветовать друзьям»: кто советует, как устроено, установка и своя пара. */
export function Friend() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { ready, me } = useStore();
  const [info, setInfo] = useState<{ names: string[]; days: number } | null | undefined>(undefined);

  useEffect(() => {
    api
      .recommendInfo(code)
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [code]);

  useEffect(() => {
    if (ready && me) nav('/', { replace: true });
  }, [ready, me, nav]);

  if (!ready || info === undefined) return <Spinner />;
  if (me) return null;

  const names = info?.names ?? [];
  const who = names.length > 1 ? `${names[0]} и ${names[1]}` : names[0];
  const intro = who
    ? `${who} ${names.length > 1 ? 'советуют' : 'советует'} вам Половинку — один вопрос в день на двоих.${
        info!.days >= 3 ? ` ${names.length > 1 ? 'Они играют' : 'Играет'} уже ${info!.days} ${plural(info!.days, 'день', 'дня', 'дней')}.` : ''
      }`
    : undefined;

  return <Onboarding intro={intro} refCode={info ? code : undefined} context={<HowItWorks />} onDone={() => nav('/', { replace: true })} />;
}
