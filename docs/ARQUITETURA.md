# Arquitetura

Visão geral para quem vai ler ou alterar o código. O projeto é um monorepo pnpm e cada pacote tem uma
responsabilidade; as dependências só andam para um lado.

```
apps/web ──┐
apps/api ──┼──▶ packages/shared   (contrato Zod + lógica pura, sem I/O)
apps/worker┘          ▲
apps/api, worker ──▶ packages/db       (schema Drizzle e conexão)
apps/api, worker ──▶ packages/storage  (StorageDriver)
```

`shared` não importa nada dos apps; `db` só conhece o schema; `storage` não importa de ninguém; **um app
nunca importa de outro app**. Essas regras são conferidas a cada `pnpm lint` (`scripts/check-architecture.mjs`).

## Contrato (`packages/shared`)

Um arquivo por domínio (`books`, `shelves`, `reading`, `sync`, `conversions`...). Os schemas Zod são a fonte
única dos tipos usados por web e API. Regras de decisão sem efeito colateral (como restaurar a posição,
qual estado vence) moram aqui e são testadas sem navegador.

## API (`apps/api`)

Cada módulo de domínio (`modules/<domínio>/`) tem quatro camadas, e cada uma só chama a debaixo:

| Camada | Faz | Não faz |
|---|---|---|
| rotas | valida a entrada, exige a sessão, chama o serviço | regra de negócio, SQL |
| serviço | casos de uso, transações, regras | HTTP |
| consultas | Drizzle, sempre com o dono no `where` | decidir regra |
| mapeamento | linha do banco para DTO | acessar o banco |

Todo recurso pertence a um usuário; recurso de outro usuário responde **404** (nunca 403). Arquivos passam
sempre pelo `StorageDriver`, que valida a chave e recusa caminhos que saiam da raiz.

## Web (`apps/web`)

Organizado por funcionalidade (`features/auth`, `library`, `reader`). Lógica pura (agrupar, ordenar,
decidir) fica em arquivos sem React, os hooks ligam a lógica ao TanStack Query e ao Dexie (IndexedDB), e os
componentes só desenham. O foliate-js é usado só por `features/reader`, por uma porta fina.

## Sincronização da posição

1. O leitor grava, a cada mudança de posição, um registro local (CFI, percentual, trecho de texto, hash do
   arquivo) numa **outbox** no IndexedDB.
2. A outbox é enviada em lote (`POST /api/sync`); o envio é **idempotente**.
3. O servidor resolve o conflito por **last-write-wins** com a chave `(updatedAt, deviceId)` e devolve um
   **cursor** opaco; os outros aparelhos pedem o que mudou desde o cursor.
4. Ao abrir um livro, a posição é restaurada em cascata: **CFI**, depois **trecho de texto**, depois
   **percentual**, depois o início. Cada degrau só é tentado se o anterior não resolver.

O status de leitura (quero ler, lendo, lido, abandonado) mora no livro, avança sozinho só para a frente e
nunca rebaixa um status marcado à mão.

## Conversão de formatos

```
web ─ POST /api/conversions ─▶ API: confere os bytes, guarda o original, cria o job, enfileira
                                         │
          worker (Calibre) ◀──── book.convert: ebook-convert ─▶ EPUB ──▶ book.ingest
                                                                               │
API ◀──────── consome book.ingest e usa o mesmo caminho do upload de EPUB ◀────┘
```

API e worker não se falam por HTTP: usam a fila (pg-boss), o storage e o banco. O Calibre só existe no
worker e roda como **processo filho isolado**: sem shell, com ambiente mínimo, pasta temporária por job,
tempo limite (que mata a árvore de processos), HTML sem seguir links para fora da pasta e saída tratada como
entrada não confiável. O formato do arquivo é reconhecido pelos **bytes**, não pela extensão.

## Segurança do conteúdo do livro

Um EPUB é HTML não confiável. O foliate-js mostra cada capítulo num iframe com `sandbox` e URL `blob:`, que
herda a origem do app; por isso a API envia, em toda resposta, uma CSP com `script-src 'self'` (sem
`unsafe-inline` e sem `blob:`), `nosniff`, `referrer-policy`, `cross-origin-opener-policy` e
`permissions-policy`. Há um teste de ponta a ponta com um EPUB hostil que prova o bloqueio.

## Qualidade

| Verificação | Onde |
|---|---|
| Biome, tamanho de arquivo, regras de arquitetura, links da documentação | `pnpm lint` |
| Tipos (TypeScript), testes (Vitest, com PostgreSQL real nos da API), build | `pnpm typecheck`, `pnpm test`, `pnpm build` |
| Navegador de verdade (Playwright), com a API e o worker no ar | `pnpm e2e` |
| Dependências com vulnerabilidade alta | `pnpm audit --prod --audit-level=high` no CI |
| Cobertura, mutação (Stryker) e análise dinâmica (OWASP ZAP), sob demanda | `pnpm coverage`, `pnpm mutation`, `pnpm dast` |

Arquivos de código passam de 250 linhas só com aviso e de 400 com erro; testes, 500.
