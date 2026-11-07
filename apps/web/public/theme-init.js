// Aplica o tema antes de o app carregar, para a página não piscar de claro para escuro.
// É um arquivo externo porque a CSP (`script-src 'self'`) proíbe script inline.
// Mantenha a chave e as cores iguais às de `src/lib/theme.ts` (há um teste que confere).
(() => {
  var choice = "system";
  try {
    choice = localStorage.getItem("leitura.theme") || "system";
  } catch (_) {}
  var dark =
    choice === "dark" ||
    (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#18181b" : "#ffffff");
})();
