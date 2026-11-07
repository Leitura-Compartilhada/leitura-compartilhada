# Como contribuir

Obrigado pelo interesse! Antes de tudo, o jeito de trabalhar aqui é um pouco diferente do usual.

## Como este repositório funciona

Este repositório público é uma **cópia curada**, gerada a partir de um repositório privado de
desenvolvimento, **uma versão por vez** (um commit por versão, com tag assinada e Release). O
histórico de desenvolvimento não é publicado.

Isso tem uma consequência prática: **não consigo mesclar um pull request diretamente**. Quando uma
contribuição é boa, eu aplico a mudança no repositório de desenvolvimento, dou o crédito (com
`Co-authored-by`) e ela chega aqui na próxima versão.

## O que fazer

1. **Abra uma issue primeiro** (bug ou sugestão) e conte o contexto. Vale mais do que um pull request
   surpresa: evita trabalho que eu não consiga aproveitar.
2. Se você já tem uma correção, anexe-a na issue (um *patch* ou um link para o seu fork). Pull
   requests são bem-vindos como forma de **mostrar** a ideia, mesmo que eu não mescle o botão.
3. **Segurança:** não use issues. Veja `SECURITY.md`.

## Licença das contribuições

O projeto é **AGPL-3.0 ou posterior**. Ao enviar código, texto ou qualquer material, você declara que
tem o direito de fazê-lo e que ele entra sob essa mesma licença. Se possível, assine o seu commit
com `Signed-off-by` (`git commit -s`).

## Para rodar e testar localmente

```bash
cp -n .env.example .env        # só se ainda não existir um .env
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm e2e         # o E2E testa o app buildado
```

O que bloqueia uma mudança no desenvolvimento: lint (Biome, tamanho de arquivo e regras de
arquitetura), tipos, testes, build, E2E e `pnpm audit`. O código e os comentários de código estão em
inglês; a documentação, em português.

## Conduta

Seja gentil e objetivo. Críticas são sobre o código, nunca sobre as pessoas.
