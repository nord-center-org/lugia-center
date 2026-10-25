# Lugia

Provedor multi-IA do NordTool: conversa com **Claude**, **ChatGPT** e **Gemini** no mesmo lugar, com histórico, anexos (imagens e PDF) e respostas em tempo real.

## Como funciona

```
NordTool (frontend) ──JWT do usuário──▶ Lugia ──▶ Claude / ChatGPT / Gemini
                                          │
                                          ├──▶ nord-tool-backend  GET /auth/me  (login e permissões)
                                          └──▶ PostgreSQL do NordTool  (lugia_conversa, lugia_mensagem)
```

- **Login e permissões ficam no NordTool.** A Lugia não emite nem valida JWT: repassa o token do usuário a `GET /api/v1/nord-tool/auth/me` e lê a permissão efetiva do módulo `LUGIA` (resultado em cache por 60 s).
- **Chaves de API ficam só no servidor**, em variáveis de ambiente. O navegador nunca as vê.
- **Histórico neutro.** Cada mensagem é gravada num formato comum (texto, imagem ou PDF), então dá para trocar de modelo no meio da conversa. A resposta de cada provedor também guarda o conteúdo original (ex.: blocos do Claude), que volta sem alteração quando a conversa continua no mesmo provedor.
- **Claude** usa thinking adaptativo, cache de prompt e, nos modelos que aceitam, `fallbacks: "default"`: se o modelo recusar um pedido, a própria API tenta de novo em outro modelo.

### Permissão `LUGIA`

| Nível | O que libera |
| --- | --- |
| `LEITURA` | Usar o chat e consultar dados do NordTool (fase 2) |
| `ESCRITA` | A Lugia executa ações no NordTool em nome do usuário (fase 2) |
| `ADMIN` | Pedir mudanças de código pelo chat via MCP do `nord-center-infra-agent` (fase 3) |

Hoje só o chat está implementado; os outros níveis já são lidos e devolvidos em `GET /modelos`.

## API

Prefixo `/api/v1/lugia`. Todas as rotas, exceto `/saude`, exigem `Authorization: Bearer <token do NordTool>`. Erros seguem o envelope do NordTool: `{ "txMensagem": "..." }`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/saude` | Situação e provedores ativos |
| GET | `/modelos` | Modelos disponíveis e nível do usuário |
| GET | `/conversas` | Conversas do usuário |
| GET | `/conversas/:id` | Mensagens (anexos sem o conteúdo) |
| PATCH | `/conversas/:id` | Renomear: `{ "titulo": "..." }` |
| DELETE | `/conversas/:id` | Excluir |
| POST | `/chat` | `{ idConversa?, modelo, texto, anexos?: [{ nome, mime, base64 }] }` → SSE |

Eventos SSE de `/chat`: `conversa` (`{ id }`), `texto` (`{ delta }`), `fim` (`{ motivo, uso }`) e `erro` (`{ mensagem }`).

Anexos: PNG, JPEG, WEBP, GIF ou PDF, até 5 por mensagem e `LUGIA_ANEXO_MAX_MB` cada.

## Rodando

Requer Node.js 22.18+ (executa TypeScript direto, sem build).

```bash
cp .env.example .env   # preencha as chaves e a conexão
npm install
npm run dev            # http://localhost:8787
```

Antes, aplique `DDL/54.lugia_conversa_ddl.sql` do `nord-tool-scripts-sql` e libere o módulo `LUGIA` para os usuários em Administração → Acessos.

Docker:

```bash
docker build -t lugia-center .
docker run --env-file .env -p 8787:8787 lugia-center
```

## Validação

```bash
npm run typecheck
npm test
```

## Próximas fases

1. **Chat multi-IA** (este repositório): concluído.
2. **IA operando o NordTool**: ferramentas que chamam a API do backend com o token do próprio usuário, então só fazem o que ele já poderia fazer. Leituras com `LEITURA`; ações de escrita com `ESCRITA` e confirmação na tela.
3. **IA desenvolvendo o NordTool**: para `ADMIN`, a Lugia usa o MCP do `nord-center-infra-agent` (branch → PR → CI → merge em `develop`), respeitando as policies existentes.
