# Componentes de terceiros

O Leitura Compartilhada é distribuído sob a **GNU AGPL-3.0 ou posterior** (veja `LICENSE` e `NOTICE`).
Estes componentes de terceiros acompanham o código-fonte, cada um sob a sua própria licença, todas
compatíveis com a AGPL-3.0. Os textos de licença ficam junto de cada componente.

## Incluídos no repositório (`apps/web/src/vendor/foliate-js/`)

| Componente | Licença | Autor | Onde está o texto da licença |
|---|---|---|---|
| [foliate-js](https://github.com/johnfactotum/foliate-js) | MIT | John Factotum | `apps/web/src/vendor/foliate-js/LICENSE` |
| [zip.js](https://github.com/gildas-lormeau/zip.js) (`vendor/zip.js`) | BSD-3-Clause | Gildas Lormeau | no repositório do projeto original |
| [fflate](https://github.com/101arrowz/fflate) (`vendor/fflate.js`) | MIT | Arjun Barrett | no repositório do projeto original |
| [PDF.js](https://mozilla.github.io/pdf.js/) 5.5.207 (`vendor/pdfjs/`) | Apache-2.0 | Mozilla Foundation | cabeçalho de cada arquivo `pdf*.mjs` |
| Mapas de caracteres (CMaps) do PDF.js | BSD-3-Clause | Adobe Systems | `vendor/pdfjs/cmaps/LICENSE` |
| Fontes Foxit (`standard_fonts/Foxit*`) | BSD-3-Clause | PDFium Authors | `vendor/pdfjs/standard_fonts/LICENSE_FOXIT` |
| Fontes Liberation Sans (`standard_fonts/Liberation*`) | SIL OFL 1.1 | Red Hat, Google | `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` |

O leitor de PDF do foliate-js está **desligado** nesta versão (o app recusa PDF); os arquivos do
PDF.js ficam no repositório por vir junto do foliate-js.

## Programas externos (não distribuídos aqui)

- **[Calibre](https://calibre-ebook.com/)** (GNU GPL v3), usado pelo worker apenas como **programa
  externo** (`ebook-convert`, chamado por linha de comando) para converter MOBI, AZW3, FB2, DOCX,
  TXT, Markdown e HTML em EPUB. O Calibre não faz parte deste repositório, não é incorporado ao código
  e deve ser instalado à parte por quem executar o worker.

## Dependências npm

As bibliotecas instaladas pelo `pnpm install` (React, Fastify, Drizzle, Better Auth, entre outras)
têm cada uma a sua licença, declarada no `package.json` do respectivo pacote e em `node_modules`.
O `pnpm audit` roda no CI a cada mudança.

## Texto da licença Apache-2.0 (PDF.js)

O PDF.js é licenciado sob a Apache License, Version 2.0. O texto completo está em
<https://www.apache.org/licenses/LICENSE-2.0> e no cabeçalho de `apps/web/src/vendor/foliate-js/vendor/pdfjs/pdf.mjs`.
