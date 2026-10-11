/** Название приложения. Меняется здесь, в web/index.html, манифесте и серверных текстах. */
export const APP_NAME = 'Половинка';
/** Винительный падеж: «добавьте Половинку», «откройте Половинку». */
export const APP_NAME_ACC = 'Половинку';
export const APP_TAGLINE = 'один вопрос в день на двоих';

/** Подставляет имена в шаблон вопроса. */
export function renderText(template: string, me: string, partner: string): string {
  return template.replaceAll('{me}', me).replaceAll('{partner}', partner || 'половинка');
}

/** «Стас и Ира» */
export function pairTitle(a: string, b: string | null | undefined): string {
  return b ? `${a} и ${b}` : a;
}
