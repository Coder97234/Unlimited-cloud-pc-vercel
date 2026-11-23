import { common, createLowlight } from 'lowlight';
const syntax = createLowlight(common);
export function highlightCode(language: string, code: string) {
  if (syntax.registered(language)) return syntax.highlight(language, code);
}
