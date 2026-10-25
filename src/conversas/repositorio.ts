import pg from "pg";
import type { IdProvedor, Mensagem, Parte } from "../tipos.ts";

export interface ResumoConversa {
  id: number;
  titulo: string;
  atualizadaEm: string;
}

export interface NovaMensagem {
  papel: Mensagem["papel"];
  partes: Parte[];
  provedor?: IdProvedor;
  modelo?: string;
  nativo?: unknown;
  uso?: { entrada: number; saida: number };
}

export interface RepositorioConversas {
  listar(idUsuario: number): Promise<ResumoConversa[]>;
  criar(idUsuario: number, titulo: string): Promise<number>;
  /** Mensagens da conversa, ou null se ela não existir ou não for do usuário. */
  mensagens(idUsuario: number, idConversa: number): Promise<Mensagem[] | null>;
  adicionar(idConversa: number, mensagem: NovaMensagem): Promise<void>;
  renomear(idUsuario: number, idConversa: number, titulo: string): Promise<boolean>;
  excluir(idUsuario: number, idConversa: number): Promise<boolean>;
}

export function criarPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  // As tabelas do NordTool ficam no schema nord_tool (criado pelo nord-tool-scripts-sql).
  pool.on("connect", cliente => {
    void cliente.query("SET search_path TO nord_tool, public");
  });
  return pool;
}

export function criarRepositorio(pool: pg.Pool): RepositorioConversas {
  return {
    async listar(idUsuario) {
      const { rows } = await pool.query(
        `SELECT id_conversa, ds_titulo, dh_atualizacao
           FROM lugia_conversa
          WHERE id_usuario = $1
          ORDER BY dh_atualizacao DESC
          LIMIT 200`,
        [idUsuario],
      );
      return rows.map(r => ({ id: Number(r.id_conversa), titulo: r.ds_titulo, atualizadaEm: r.dh_atualizacao.toISOString() }));
    },

    async criar(idUsuario, titulo) {
      const { rows } = await pool.query(
        `INSERT INTO lugia_conversa (id_usuario, ds_titulo) VALUES ($1, $2) RETURNING id_conversa`,
        [idUsuario, titulo.slice(0, 200)],
      );
      return Number(rows[0].id_conversa);
    },

    async mensagens(idUsuario, idConversa) {
      const dono = await pool.query(
        `SELECT 1 FROM lugia_conversa WHERE id_conversa = $1 AND id_usuario = $2`,
        [idConversa, idUsuario],
      );
      if (dono.rowCount === 0) return null;
      const { rows } = await pool.query(
        `SELECT cd_papel, cd_provedor, tx_partes, tx_conteudo_nativo
           FROM lugia_mensagem
          WHERE id_conversa = $1
          ORDER BY id_mensagem`,
        [idConversa],
      );
      return rows.map(r => ({
        papel: r.cd_papel,
        partes: r.tx_partes,
        provedor: r.cd_provedor ?? undefined,
        nativo: r.tx_conteudo_nativo ?? undefined,
      }));
    },

    async adicionar(idConversa, m) {
      await pool.query(
        `INSERT INTO lugia_mensagem
           (id_conversa, cd_papel, cd_provedor, cd_modelo, tx_partes, tx_conteudo_nativo, qt_tokens_entrada, qt_tokens_saida)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          idConversa,
          m.papel,
          m.provedor ?? null,
          m.modelo ?? null,
          JSON.stringify(m.partes),
          m.nativo === undefined ? null : JSON.stringify(m.nativo),
          m.uso?.entrada ?? null,
          m.uso?.saida ?? null,
        ],
      );
      await pool.query(`UPDATE lugia_conversa SET dh_atualizacao = NOW() WHERE id_conversa = $1`, [idConversa]);
    },

    async renomear(idUsuario, idConversa, titulo) {
      const r = await pool.query(
        `UPDATE lugia_conversa SET ds_titulo = $3 WHERE id_conversa = $1 AND id_usuario = $2`,
        [idConversa, idUsuario, titulo.slice(0, 200)],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async excluir(idUsuario, idConversa) {
      const r = await pool.query(`DELETE FROM lugia_conversa WHERE id_conversa = $1 AND id_usuario = $2`, [idConversa, idUsuario]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}
