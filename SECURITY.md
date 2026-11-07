# Segurança

## Como relatar uma falha

**Não abra uma issue pública** para uma vulnerabilidade. Use o relato privado do GitHub:
**[Security › Report a vulnerability](https://github.com/Leitura-Compartilhada/leitura-compartilhada/security/advisories/new)**.
Só eu (o mantenedor) e quem eu convidar vemos o relato.

Inclua, se puder: a versão (ou o commit), o que você fez, o que esperava e o que aconteceu, e o
impacto que você imagina.

## O que esperar

Este é um projeto mantido por **uma pessoa**, em tempo livre. Meta, não promessa:

- confirmo o recebimento em até **7 dias**;
- avalio e respondo com o plano em até **30 dias**;
- falhas graves (execução de código, acesso a dados de outro usuário, vazamento de segredo) têm
  prioridade sobre qualquer outra coisa;
- publico a correção numa nova versão e credito quem relatou, se a pessoa quiser.

## Versões com correção

Só a **última versão publicada** recebe correções de segurança.

## Escopo

Dentro do escopo: o código deste repositório (API, worker, web, scripts).

- autenticação e autorização (um usuário nunca deve ver ou alterar o que é de outro: recurso alheio
  responde 404);
- o tratamento de arquivos enviados (EPUB, ZIP, HTML, MOBI, DOCX e os outros formatos convertidos);
- o isolamento do conteúdo do livro no leitor (CSP e `sandbox` dos capítulos);
- o processo do Calibre chamado pelo worker (limites, ambiente, caminhos).

Fora do escopo:

- falhas do **Calibre**, do **PDF.js**, do **foliate-js** ou de outras dependências em si (relate aos
  projetos deles; se nosso uso agrava o problema, aí sim relate aqui);
- ataques que exigem acesso físico ao aparelho ou ao servidor, ou que já tenham o controle da conta;
- configuração insegura feita por quem hospeda (por exemplo, expor a API sem HTTPS ou deixar o
  cadastro aberto na internet).

## Riscos conhecidos e aceitos

- **O app é pensado para uso pessoal**, atrás de uma rede privada (Tailscale). Hospedar na internet
  aberta exige mais cuidado do que este repositório documenta hoje.
- **O Calibre roda com o mesmo usuário do sistema** (sem contêiner, sem limite de memória). O
  isolamento está planejado para a fase de deploy.
- A CSP permite `style-src 'unsafe-inline'`, porque o leitor injeta estilo nos capítulos; o que
  protege é o `script-src 'self'` (sem `unsafe-inline`).

## Como verificar o que você baixou

Cada versão tem uma **tag assinada** (`git tag -v vX.Y.Z`, com a chave publicada no perfil do
mantenedor no GitHub) e commits com o selo **Verified**.
