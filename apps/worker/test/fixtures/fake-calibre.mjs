// Calibre de mentira para os testes: o comportamento vem do conteúdo do arquivo de entrada.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [input, output] = process.argv.slice(2);
const mode = readFileSync(input, "utf8").trim();
const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

if (mode === "OK") {
  writeFileSync(output, Buffer.concat([zipHead, Buffer.from(" epub de mentira")]));
} else if (mode === "FAIL") {
  console.error("Traceback (most recent call last): boom");
  process.exit(1);
} else if (mode === "DRM") {
  console.error("calibre.ebooks.DRMError: This book is protected by DRM");
  process.exit(1);
} else if (mode === "EMPTY") {
  writeFileSync(output, "");
} else if (mode === "NOZIP") {
  writeFileSync(output, "isto não é um zip");
} else if (mode === "ENV") {
  writeFileSync(
    output,
    Buffer.concat([
      zipHead,
      Buffer.from(
        JSON.stringify({
          HOME: process.env.HOME,
          DB: process.env.DATABASE_URL ?? null,
          QT: process.env.QT_QPA_PLATFORM,
          CONFIG: process.env.CALIBRE_CONFIG_DIRECTORY,
          ARGS: process.argv.slice(2),
        }),
      ),
    ]),
  );
} else if (mode === "HANG") {
  // Um neto que também precisa morrer junto com o processo do Calibre.
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  writeFileSync(path.join(process.env.TMP, "grandchild.pid"), String(grandchild.pid));
  setInterval(() => {}, 1000);
} else {
  console.error(`modo desconhecido: ${mode}`);
  process.exit(2);
}
