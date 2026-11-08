// Parte pura do navegador do júri (sem navegador, sem rede): nomes de sessão, perfis de tela, leitura dos
// comandos e formato do diário. A CLI está em juri-browser.mjs.

/** Perfis de tela do cliente: o PC e o celular (toque). */
export const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false },
  celular: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
};

/** Sessão de 1 a 16 letras minúsculas ou dígitos: vira nome de pasta, então nada de `..` nem barras. */
export const isSessionName = (name) => /^[a-z0-9]{1,16}$/.test(name);

/** Só o servidor de teste local: o cliente nunca navega para fora da máquina. */
export function isAllowedUrl(url, baseUrl) {
  try {
    const target = new URL(url, baseUrl);
    const base = new URL(baseUrl);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

/** Comandos que o cliente pode dar e quantos argumentos cada um pede (mínimo). */
export const COMMANDS = {
  abrir: 1,
  ver: 0,
  clicar: 1,
  digitar: 2,
  "enviar-arquivo": 2,
  "enviar-pasta": 1,
  voltar: 0,
  captura: 1,
  esperar: 0,
  rolar: 0,
  tocar: 2,
  parar: 0,
};

/** Lê `["clicar", "Entrar"]` e devolve o comando e os argumentos, ou o erro em português. */
export function parseCommand(argv) {
  const [name, ...args] = argv;
  if (!name) return { error: `informe um comando: ${Object.keys(COMMANDS).join(", ")}` };
  if (!(name in COMMANDS)) return { error: `comando desconhecido "${name}"` };
  if (args.length < COMMANDS[name])
    return { error: `"${name}" pede ${COMMANDS[name]} argumento(s)` };
  return { name, args };
}

/** Corta textos longos para o diário e a resposta não ficarem gigantes. */
export function clip(text, max = 2500) {
  return text.length <= max ? text : `${text.slice(0, max)}… [cortado, ${text.length} caracteres]`;
}

/** Uma linha do diário (JSON): o que o cliente fez, onde estava e o que deu errado no caminho. */
export function diaryEntry({
  n,
  session,
  command,
  args,
  url,
  ok,
  message,
  consoleErrors,
  failedRequests,
  screenshot,
}) {
  return {
    n,
    em: new Date().toISOString(),
    sessao: session,
    comando: command,
    args,
    url,
    ok,
    ...(message ? { mensagem: clip(message, 4000) } : {}),
    ...(consoleErrors?.length ? { erros_console: consoleErrors } : {}),
    ...(failedRequests?.length ? { requisicoes_falhas: failedRequests } : {}),
    ...(screenshot ? { captura: screenshot } : {}),
  };
}

/** Nome seguro para arquivo de captura (sem pastas nem caracteres estranhos). */
export const safeFileName = (name) =>
  name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "captura";
