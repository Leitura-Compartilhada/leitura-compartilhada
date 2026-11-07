/**
 * Cabeçalhos de segurança de toda resposta (JSON, arquivos do web e download de livro).
 *
 * O ponto central é a CSP. O foliate-js mostra cada capítulo de um EPUB (HTML não confiável) num
 * iframe com `sandbox="allow-same-origin allow-scripts"`, e o `epub.js` transforma o capítulo numa
 * URL `blob:`, que herda a origem do app. Sem CSP, um `<script>` ou `onerror` dentro do livro
 * roda como o app: chama `/api/*` com a sessão do usuário, lê o IndexedDB e pode trocar arquivos
 * do cache do service worker. Documentos `blob:`, `about:blank` e `srcdoc` herdam a política da
 * página que os criou, então bloquear script inline e `javascript:` aqui cobre os capítulos.
 *
 * - `script-src 'self'`: sem `'unsafe-inline'` (bloqueia `<script>`, `on*=` e `javascript:`) e sem
 *   `blob:` (bloqueia `<script src="blob:...">`).
 * - `style-src ... 'unsafe-inline'`: o foliate injeta `<style>` em cada capítulo, e o React usa
 *   `style=`. CSS não executa código.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "frame-src 'self' blob:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  // O app não usa câmera, microfone, localização, pagamento nem USB; um capítulo hostil também não
  // deve conseguir pedir. (A tela acesa da rolagem automática, `screen-wake-lock`, fica liberada.)
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
