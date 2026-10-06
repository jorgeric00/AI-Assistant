// JIRA Cloud (API v3) devuelve la descripción en Atlassian Document Format (JSON).
// La app solo la muestra como texto, así que se aplana conservando párrafos y listas.

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

const BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'blockquote', 'rule', 'panel', 'table', 'tableRow', 'mediaSingle']);

export function adfToText(doc: unknown): string {
  const out: string[] = [];
  const walk = (node: AdfNode, listPrefix: string | null) => {
    switch (node.type) {
      case 'text':
        out.push(node.text ?? '');
        return;
      case 'hardBreak':
        out.push('\n');
        return;
      case 'mention':
      case 'emoji':
        out.push(String(node.attrs?.text ?? node.attrs?.shortName ?? ''));
        return;
      case 'inlineCard':
        out.push(String(node.attrs?.url ?? ''));
        return;
      case 'bulletList':
      case 'orderedList':
        (node.content ?? []).forEach((item, i) => walk(item, node.type === 'orderedList' ? `${i + 1}. ` : '- '));
        return;
      case 'listItem':
        out.push(listPrefix ?? '- ');
        (node.content ?? []).forEach((c) => walk(c, null));
        return;
      case 'tableCell':
      case 'tableHeader':
        (node.content ?? []).forEach((c) => walk(c, null));
        out.push(' | ');
        return;
    }
    (node.content ?? []).forEach((c) => walk(c, null));
    if (node.type && BLOCKS.has(node.type) && out.at(-1) !== '\n') out.push('\n');
  };
  if (doc && typeof doc === 'object') walk(doc as AdfNode, null);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
