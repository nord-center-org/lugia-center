/** Configuração lida do ambiente. Chaves de API nunca vão para código, logs ou respostas. */

export interface Config {
  porta: number;
  /** URL base do nord-tool-backend, ex.: http://localhost:8080 */
  nordToolApi: string;
  /** Origens liberadas no CORS (frontend). */
  origens: string[];
  databaseUrl: string;
  chaves: { claude?: string; openai?: string; gemini?: string };
  modelos: { claude: string[]; openai: string[]; gemini: string[] };
  /** Tamanho máximo de cada anexo, em bytes. */
  anexoMaxBytes: number;
}

const lista = (valor: string | undefined, padrao: string[] = []): string[] => {
  if (valor === undefined) return padrao;
  return valor.split(",").map(v => v.trim()).filter(Boolean);
};

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nordToolApi = env.NORD_TOOL_API_URL?.trim();
  if (!nordToolApi) throw new Error("Defina NORD_TOOL_API_URL (URL do nord-tool-backend)");
  const databaseUrl = env.LUGIA_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("Defina LUGIA_DATABASE_URL (PostgreSQL do NordTool)");
  return {
    porta: Number(env.PORT ?? 8787),
    nordToolApi: nordToolApi.replace(/\/+$/, ""),
    origens: lista(env.LUGIA_CORS_ORIGINS, ["http://localhost:5173"]),
    databaseUrl,
    chaves: {
      claude: env.ANTHROPIC_API_KEY?.trim() || undefined,
      openai: env.OPENAI_API_KEY?.trim() || undefined,
      gemini: env.GEMINI_API_KEY?.trim() || undefined,
    },
    modelos: {
      claude: lista(env.LUGIA_MODELOS_CLAUDE, ["claude-opus-5-5", "claude-sonnet-5-5"]),
      // Sem padrão para OpenAI: os IDs mudam com frequência; configure os que sua chave acessa.
      openai: lista(env.LUGIA_MODELOS_OPENAI),
      gemini: lista(env.LUGIA_MODELOS_GEMINI, ["gemini-flash-latest"]),
    },
    anexoMaxBytes: Number(env.LUGIA_ANEXO_MAX_MB ?? 10) * 1024 * 1024,
  };
}
