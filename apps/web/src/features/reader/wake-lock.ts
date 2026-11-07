/** Mantém a tela acesa durante a rolagem automática. Melhor esforço: nunca lança. */
export class WakeLockHolder {
  #lock: WakeLockSentinel | null = null;

  async acquire(): Promise<void> {
    try {
      this.#lock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // Sem o bloqueio de tela (negado, bateria baixa, navegador sem suporte) a leitura
      // continua; a tela só pode apagar sozinha.
      this.#lock = null;
    }
  }

  async release(): Promise<void> {
    const lock = this.#lock;
    this.#lock = null;
    try {
      await lock?.release();
    } catch {
      // já liberado pelo sistema
    }
  }
}
