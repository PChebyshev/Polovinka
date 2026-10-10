/** Подставляет имена в шаблон вопроса. */
export function renderText(template: string, me: string, partner: string): string {
  return template.replaceAll('{me}', me).replaceAll('{partner}', partner || 'половинка');
}

/** «Стас и Ира» */
export function pairTitle(a: string, b: string | null | undefined): string {
  return b ? `${a} и ${b}` : a;
}
