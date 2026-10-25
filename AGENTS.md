# Instruções para agentes

A Lugia é o provedor multi-IA (Claude, ChatGPT e Gemini) do NordTool. Leia o `README.md` antes de alterar.

- Stack: Node.js 22.18+ executando TypeScript direto (sem build), Hono, `pg` e Zod. Use só sintaxe apagável (sem `enum`, `namespace` ou parameter properties) e importe arquivos locais com extensão `.ts`.
- Cada provedor fica em `src/provedores/<provedor>.ts` e usa o SDK oficial do fornecedor. Não misture SDKs num mesmo arquivo. A conversão do histórico neutro (`src/tipos.ts`) para o formato do provedor é uma função pura e testada.
- Login e permissões são do nord-tool-backend (`/auth/me`, módulo `LUGIA`). Não crie autenticação própria.
- Chaves de API e a conexão do banco vêm só do ambiente. Nunca as registre em logs, respostas ou código.
- O schema (`lugia_conversa`, `lugia_mensagem`) é mantido no `nord-tool-scripts-sql`.
- Mantenha o prompt de sistema estável entre as mensagens (sem data/hora) e o histórico só com acréscimos: isso preserva o cache de prompt e os blocos de thinking do Claude.
- Antes de publicar: `npm run typecheck` e `npm test`.
