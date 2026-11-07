import { spawnSync } from "node:child_process";

/** Há um `ebook-convert` utilizável? Os specs de conversão pulam quando não há. */
export const calibreAvailable =
  spawnSync(process.env.CALIBRE_BIN ?? "ebook-convert", ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  }).status === 0;
