import { createHash } from "node:crypto";

/**
 * A Lugia não emite nem valida JWT por conta própria: repassa o token do usuário ao nord-tool-backend
 * (`GET /auth/me`), que devolve as permissões efetivas. Assim login, expiração e acessos continuam
 * num lugar só.
 */

export type Acao = "NENHUM" | "LEITURA" | "ESCRITA" | "ADMIN";

export interface Permissao {
  cdModulo: string;
  cdAcao: string;
}

export interface UsuarioNord {
  id: number;
  nome: string;
  email: string;
  perfil: string;
  permissoes: Permissao[];
}

export const MODULO_LUGIA = "LUGIA";

const NIVEL: Record<Acao, number> = { NENHUM: 0, LEITURA: 1, ESCRITA: 2, ADMIN: 3 };

/** Nível do usuário no módulo; o backend já devolve as permissões efetivas (sem curinga). */
export function nivelLugia(permissoes: Permissao[] | undefined): Acao {
  const acao = (permissoes ?? []).find(p => p.cdModulo === MODULO_LUGIA)?.cdAcao;
  return acao && acao in NIVEL ? (acao as Acao) : "NENHUM";
}

export function atende(nivel: Acao, exigido: Acao): boolean {
  return NIVEL[nivel] >= NIVEL[exigido];
}

export function extrairToken(cabecalho: string | undefined): string | null {
  const achado = /^Bearer\s+(\S+)$/i.exec(cabecalho?.trim() ?? "");
  return achado ? achado[1] : null;
}

export class ErroAutenticacao extends Error {
  readonly status: 401 | 403 | 502;
  constructor(status: 401 | 403 | 502, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

type BuscarFn = typeof fetch;

/** Consulta /auth/me com cache curto (por hash do token) para não chamar o backend a cada mensagem. */
export function criarAutenticador(apiBase: string, buscar: BuscarFn = fetch, ttlMs = 60_000, agora = () => Date.now()) {
  const cache = new Map<string, { usuario: UsuarioNord; ate: number }>();

  return async function autenticar(token: string): Promise<UsuarioNord> {
    const chave = createHash("sha256").update(token).digest("hex");
    const guardado = cache.get(chave);
    if (guardado && guardado.ate > agora()) return guardado.usuario;
    cache.delete(chave);

    let resposta: Response;
    try {
      resposta = await buscar(`${apiBase}/api/v1/nord-tool/auth/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch {
      throw new ErroAutenticacao(502, "NordTool indisponível para validar a sessão.");
    }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroAutenticacao(401, "Sessão inválida ou expirada.");
    }
    if (!resposta.ok) throw new ErroAutenticacao(502, "NordTool não validou a sessão.");
    const corpo = (await resposta.json()) as { body?: UsuarioNord };
    if (!corpo.body || typeof corpo.body.id !== "number") {
      throw new ErroAutenticacao(502, "Resposta inesperada do NordTool.");
    }
    if (cache.size > 1000) cache.clear();
    cache.set(chave, { usuario: corpo.body, ate: agora() + ttlMs });
    return corpo.body;
  };
}
