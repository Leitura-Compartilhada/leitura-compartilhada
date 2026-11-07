# Leitura Compartilhada

Leitor de EPUB para o navegador (PWA) que guarda a **posição exata** onde você parou, no nível do
parágrafo (EPUB CFI), e a **sincroniza entre o celular e o computador** pela sua conta.

> **Status:** em desenvolvimento ativo, para **uso pessoal**. Funciona, mas ainda não há hospedagem
> pronta: a ideia é rodar no seu próprio computador ou servidor, atrás de uma rede privada (por exemplo,
> [Tailscale](https://tailscale.com)). Os `Dockerfile`s existem, mas **ainda não estão prontos para
> produção**. Leitura offline completa, anotações e leitura de PDF ainda não existem.

## O que já faz

- **Leitor** com [foliate-js](https://github.com/johnfactotum/foliate-js): rolagem contínua ou páginas,
  fonte, colunas, margens, temas claro, escuro e sépia, rolagem automática com velocidade ajustável.
- **Posição exata sincronizada**: ao abrir em outro aparelho, volta para o mesmo parágrafo, mesmo que o
  arquivo tenha mudado (a restauração tenta o CFI, depois um trecho do texto, depois o percentual).
- **Estante**: status (quero ler, lendo, lido, abandonado), estantes, tags, séries reconhecidas pelo
  título, capas e metadados lidos do próprio EPUB, edição e exclusão.
- **Importação em lote**: vários arquivos ou uma pasta inteira, com revisão do que já está na estante.
- **Conversão para EPUB** de MOBI/AZW3, FB2, DOCX, TXT, Markdown e HTML, pelo [Calibre](https://calibre-ebook.com)
  (sem DRM), numa fila separada.
- **PWA instalável**, com tema claro e escuro em todo o app.

## Como a posição é guardada

A posição é gravada como **CFI** (um endereço dentro do HTML do livro), junto com o percentual, um trecho
do texto e o hash do arquivo. O servidor resolve conflitos entre aparelhos por *last-write-wins*
(`(updatedAt, deviceId)`), e cada aparelho guarda as mudanças numa fila local (outbox) para enviar
quando houver rede. Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Estrutura

```
apps/
  web/      React + Vite + Tailwind + shadcn/ui (PWA)
  api/      Fastify + Better Auth + Drizzle
  worker/   fila (pg-boss) que converte formatos com o Calibre
packages/
  shared/   contrato (schemas Zod) e lógica pura compartilhada
  db/       schema Drizzle e migrações (PostgreSQL)
  storage/  armazenamento de arquivos (disco local)
e2e/        testes Playwright contra um servidor real
scripts/    verificações de qualidade (tamanho de arquivo, arquitetura, links), cobertura, mutação
docker/     Dockerfiles da API e do worker
```

## Requisitos

- Node 24 e pnpm 11
- Docker (PostgreSQL)
- [Calibre](https://calibre-ebook.com) (`ebook-convert`), para o worker e para os testes de conversão

## Como rodar

```bash
# Só na PRIMEIRA vez neste computador. Se já existir um .env, NÃO copie: ele seria sobrescrito.
cp -n .env.example .env          # PowerShell: if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:5173 · API: http://localhost:3000 (`GET /health`)
- O `.env` **não vai para o git** e guarda a configuração do seu servidor (URLs, segredo de login,
  cadastro aberto ou fechado). Guarde uma cópia fora do repositório.
- Em produção, a API serve o web buildado (`pnpm build`) numa origem só. A API se recusa a iniciar com o
  segredo padrão, e o cadastro fecha sozinho (`ALLOW_SIGNUP`).

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | web, api e worker em paralelo |
| `pnpm lint` | Biome, tamanho de arquivo, regras de arquitetura e links da documentação |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | tipos, testes (Vitest) e build |
| `pnpm e2e` | Playwright (rode `pnpm build` antes: o teste usa o app buildado) |
| `pnpm coverage` / `pnpm mutation` / `pnpm dast` | cobertura, teste de mutação e análise de segurança dinâmica |
| `pnpm db:generate` / `db:migrate` | Drizzle |

## Segurança

O conteúdo de um livro **não é confiável**: o leitor roda cada capítulo num iframe com `sandbox`, e a
API envia uma CSP sem `unsafe-inline` para scripts. Todo recurso é do dono da conta (de outro usuário,
responde 404). Veja [`SECURITY.md`](SECURITY.md) para relatar uma falha **em particular**.

## Contribuir

Leia [`CONTRIBUTING.md`](CONTRIBUTING.md): este repositório é uma cópia por versão de um repositório
privado de desenvolvimento, então o caminho é abrir uma issue.

## Licença e autoria

Copyright (C) 2026 Getulio Vagner. Licenciado sob a **[GNU AGPL-3.0 ou posterior](LICENSE)**: você pode usar,
estudar, modificar e redistribuir; se rodar uma versão modificada como serviço de rede, precisa oferecer
o código dela a quem usar o serviço. Componentes de terceiros: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
Se usar o projeto em um trabalho, veja [`CITATION.cff`](CITATION.cff).

Cada versão é uma **tag assinada** com commits marcados como **Verified** no GitHub.
