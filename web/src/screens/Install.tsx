import { APP_NAME_ACC } from '@polovinka/shared';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Label } from '../components/ui';
import { InstallGuide } from '../components/InstallGuide';
import { LoginCodeBox } from '../components/LoginCode';
import { isStandalone } from '../lib/install';

/** Последний шаг для iPhone: страница загружена с кодом в манифесте, осталось добавить на экран. */
export function Install() {
  const nav = useNavigate();
  if (isStandalone()) {
    nav('/', { replace: true });
    return null;
  }
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <Label>Остался один шаг</Label>
      <h1 className="mt-1 text-2xl font-bold">Добавьте {APP_NAME_ACC} на экран</h1>
      <p className="mt-2 text-muted">Иконка откроется уже в вашем аккаунте, вводить ничего не нужно.</p>

      <Card tone="accent" className="mt-4">
        <InstallGuide finalStep={`Откройте ${APP_NAME_ACC} с иконки — вы сразу окажетесь в своей паре. Эту вкладку можно закрыть.`} />
      </Card>

      <Card className="mt-4">
        <Label>Если приложение всё же спросит имя</Label>
        <p className="mt-2 text-sm text-muted">Нажмите там «Я уже начал(а) в Safari» и введите код:</p>
        <LoginCodeBox auto />
      </Card>

      <Button variant="ghost" className="mt-4 w-full" onClick={() => nav('/')}>
        Вернуться
      </Button>
    </div>
  );
}
