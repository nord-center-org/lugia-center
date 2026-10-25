import { serve } from "@hono/node-server";
import { criarApp } from "./app.ts";
import { lerConfig } from "./config.ts";
import { criarPool, criarRepositorio } from "./conversas/repositorio.ts";
import { criarAutenticador } from "./nordtool/autenticacao.ts";
import { criarProvedores } from "./provedores/registro.ts";

const config = lerConfig();
const provedores = criarProvedores(config);
if (provedores.length === 0) {
  console.warn("[lugia] nenhum provedor configurado: defina ANTHROPIC_API_KEY, OPENAI_API_KEY e/ou GEMINI_API_KEY.");
}

const pool = criarPool(config.databaseUrl);
const app = criarApp({
  config,
  provedores,
  repositorio: criarRepositorio(pool),
  autenticar: criarAutenticador(config.nordToolApi),
});

serve({ fetch: app.fetch, port: config.porta }, info => {
  console.log(`[lugia] ouvindo na porta ${info.port} · provedores: ${provedores.map(p => p.id).join(", ") || "nenhum"}`);
});

const encerrar = () => {
  void pool.end().finally(() => process.exit(0));
};
process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
