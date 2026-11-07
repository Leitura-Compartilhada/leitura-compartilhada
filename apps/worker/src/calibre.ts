import { spawn } from "node:child_process";
import path from "node:path";
import type { ConversionErrorCode, ConvertibleFormat } from "@leitura/shared";

/** Falha de uma conversão, com o código estável que o usuário vê e o detalhe técnico do log. */
export class ConversionFailure extends Error {
  override readonly name = "ConversionFailure";
  constructor(
    readonly code: ConversionErrorCode,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export type CalibreOptions = {
  /** Executável do Calibre (`CALIBRE_BIN`). */
  bin: string;
  /** Argumentos antes dos do Calibre; só os testes usam (rodar um script falso com `node`). */
  binArgs?: string[];
  input: string;
  output: string;
  format: ConvertibleFormat;
  /** Pasta temporária do job: vira `HOME` e guarda a configuração e o cache do Calibre. */
  workDir: string;
  timeoutMs: number;
};

/** Depois de matar o processo, quanto esperar o `close` antes de desistir e dar o job por perdido. */
const KILL_GRACE_MS = 5_000;

/** Quanto da saída do Calibre guardar para diagnosticar (o final é o que importa). */
const OUTPUT_TAIL_BYTES = 16 * 1024;

/** Argumentos por formato. `--no-default-epub-cover`: sem capa gerada (precisaria desenhar com Qt). */
export function calibreArgs(options: CalibreOptions): string[] {
  const args = [options.input, options.output, "--no-default-epub-cover"];
  // Markdown precisa avisar o formato; para TXT o Calibre decide sozinho (codificação e capítulos).
  if (options.format === "md") args.push("--formatting-type", "markdown");
  // HTML: sem seguir links. Por padrão o Calibre segue `<a href="../outro.html">` e traz para o EPUB
  // arquivos de FORA da pasta do job (verificado na 9.16). Com 0 só o arquivo enviado é lido.
  if (options.format === "html") args.push("--max-levels", "0");
  return args;
}

/**
 * Ambiente mínimo do processo filho: só o necessário para achar as bibliotecas, e tudo o que o
 * Calibre grava (configuração, cache, temporários) dentro da pasta do job, sem tocar no Calibre
 * do próprio usuário. Nada do ambiente do servidor (segredos, banco) passa para o filho.
 */
export function calibreEnv(workDir: string): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL"]) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return {
    ...inherited,
    HOME: workDir,
    USERPROFILE: workDir,
    TMPDIR: path.join(workDir, "tmp"),
    TEMP: path.join(workDir, "tmp"),
    TMP: path.join(workDir, "tmp"),
    CALIBRE_CONFIG_DIRECTORY: path.join(workDir, "config"),
    CALIBRE_CACHE_DIRECTORY: path.join(workDir, "cache"),
    CALIBRE_TEMP_DIR: path.join(workDir, "tmp"),
    QT_QPA_PLATFORM: "offscreen",
  };
}

/** Mata o processo e todos os filhos (o `ebook-convert` abre subprocessos). */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).on("error", () => {}); // sem o ouvinte, uma falha ao iniciar o taskkill derrubaria o worker
    } else {
      process.kill(-pid, "SIGKILL"); // o filho é líder de grupo (detached)
    }
  } catch {
    // já terminou
  }
}

/** DRM aparece na saída do Calibre como `DRMError` ou "protected by DRM". */
function looksLikeDrm(output: string): boolean {
  return /DRMError|protected by DRM|DRM[- ]?protected|encrypted with DRM/i.test(output);
}

/**
 * Converte um arquivo para EPUB com o `ebook-convert`. Sem shell (argumentos em vetor), com
 * tempo máximo e ambiente isolado. Lança `ConversionFailure`: `TIMEOUT`, `DRM` ou
 * `CONVERSION_FAILED`.
 */
export function runCalibre(options: CalibreOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [...(options.binArgs ?? []), ...calibreArgs(options)];
    const child = spawn(options.bin, args, {
      cwd: options.workDir,
      env: calibreEnv(options.workDir),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: false,
    });

    let tail = "";
    const collect = (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    let settled = false;
    let timedOut = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      // Se um neto segurar a saída aberta, o `close` pode nunca vir: não prende a fila por isso.
      graceTimer = setTimeout(
        () => finish(new ConversionFailure("TIMEOUT", `passou de ${options.timeoutMs} ms`)),
        KILL_GRACE_MS,
      );
    }, options.timeoutMs);

    const finish = (error?: ConversionFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      if (error) reject(error);
      else resolve();
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      const detail =
        error.code === "ENOENT"
          ? `executável do Calibre não encontrado: ${options.bin}`
          : `falha ao iniciar o Calibre: ${error.message}`;
      finish(new ConversionFailure("CONVERSION_FAILED", detail));
    });

    child.on("close", (code) => {
      if (timedOut) {
        finish(new ConversionFailure("TIMEOUT", `passou de ${options.timeoutMs} ms`));
      } else if (code === 0) {
        finish();
      } else if (looksLikeDrm(tail)) {
        finish(new ConversionFailure("DRM", tail.slice(-500)));
      } else {
        finish(new ConversionFailure("CONVERSION_FAILED", `código ${code}: ${tail.slice(-500)}`));
      }
    });
  });
}
