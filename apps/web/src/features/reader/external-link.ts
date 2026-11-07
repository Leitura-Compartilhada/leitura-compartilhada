/** Esquemas que um link de dentro de um livro pode abrir. `javascript:` e `data:` ficam de fora. */
const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Devolve o endereço de um link externo de livro se for seguro abrir, ou `null`.
 * O conteúdo do EPUB não é confiável: um `<a href="javascript:...">` seria executado na origem
 * do app pelo `window.open` do foliate, e `data:`/`blob:` abririam documentos arbitrários.
 */
export function safeExternalUrl(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href.trim());
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null; // relativo ou inválido: não é um link externo que dê para abrir
  }
}

/** Lê o `href_` do detalhe do evento `external-link` do foliate. */
export function hrefFromExternalLinkEvent(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null || !("href_" in detail)) return null;
  return safeExternalUrl(detail.href_);
}

/**
 * Trata um clique em link externo: cancela o comportamento padrão do foliate (que faria
 * `window.open(href)` sem `noopener`) e abre só o que é seguro, sem dar ao site de destino acesso
 * a `window.opener`.
 */
export function handleExternalLink(
  event: Event,
  open: (url: string, target: string, features: string) => unknown = window.open.bind(window),
): void {
  event.preventDefault();
  const href = hrefFromExternalLinkEvent(event);
  if (href) open(href, "_blank", "noopener,noreferrer");
}
