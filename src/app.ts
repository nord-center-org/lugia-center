import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { anexosParaPartes, esquemaAnexo } from "./anexos.ts";
import type { Config } from "./config.ts";
import type { RepositorioConversas } from "./conversas/repositorio.ts";
import {
  atende,
  ErroAutenticacao,
  extrairToken,
  nivelLugia,
  type Acao,
  type UsuarioNord,
} from "./nordtool/autenticacao.ts";
import type { Provedor } from "./provedores/provedor.ts";
import { listarModelos, provedorDoModelo } from "./provedores/registro.ts";
import type { Mensagem, Parte } from "./tipos.ts";

export interface Dependencias {
  config: Pick<Config, "origens" | "anexoMaxBytes">;
  provedores: Provedor[];
  repositorio: RepositorioConversas;
  autenticar: (token: string) => Promise<UsuarioNord>;
}

type Variaveis = { usuario: UsuarioNord; nivel: Acao };

/** Mantido estável entre as mensagens para aproveitar o cache de prompt dos provedores. */
export function promptSistema(usuario: Pick<UsuarioNord, "nome">): string {
  return [
    "Você é a Lugia, assistente de IA integrada ao NordTool, sistema de gestão de obras e entregas da Nord.",
    "Responda em português do Brasil, de forma direta e útil. Use Markdown quando ajudar a leitura.",
    "Quando não souber algo sobre os dados do NordTool, diga isso em vez de inventar.",
    `Você está conversando com ${usuario.nome}.`,
  ].join("\n");
}

/** Título inicial da conversa a partir da primeira mensagem. */
export function tituloInicial(texto: string, partes: Parte[]): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo) return limpo.length > 60 ? `${limpo.slice(0, 57)}...` : limpo;
  const anexo = partes.find(p => p.tipo !== "texto");
  return anexo && "nome" in anexo && anexo.nome ? anexo.nome : "Nova conversa";
}

/** Para a tela: tira o base64 dos anexos (pesado) e mantém só o que identifica o arquivo. */
export function partesParaTela(partes: Parte[]) {
  return partes.map(p =>
    p.tipo === "texto" ? p : p.tipo === "imagem" ? { tipo: p.tipo, nome: p.nome, mime: p.mime } : { tipo: p.tipo, nome: p.nome },
  );
}

const esquemaChat = z.object({
  idConversa: z.number().int().positive().optional(),
  modelo: z.string().min(1),
  texto: z.string().max(100_000).default(""),
  anexos: z.array(esquemaAnexo).default([]),
});

const esquemaTitulo = z.object({ titulo: z.string().trim().min(1).max(200) });

export function criarApp(dep: Dependencias) {
  const app = new Hono<{ Variables: Variaveis }>();
  const base = app.basePath("/api/v1/lugia");

  app.use("*", cors({ origin: dep.config.origens, allowHeaders: ["Authorization", "Content-Type", "X-Obra", "X-Request-Id"], maxAge: 600 }));

  base.get("/saude", c => c.json({ status: "ok", provedores: dep.provedores.map(p => p.id) }));

  base.use("*", async (c, next) => {
    if (c.req.path.endsWith("/saude")) return next();
    const token = extrairToken(c.req.header("Authorization"));
    if (!token) return c.json({ txMensagem: "Faça login no NordTool." }, 401);
    try {
      const usuario = await dep.autenticar(token);
      const nivel = nivelLugia(usuario.permissoes);
      if (!atende(nivel, "LEITURA")) return c.json({ txMensagem: "Sem acesso à Lugia. Peça liberação ao administrador." }, 403);
      c.set("usuario", usuario);
      c.set("nivel", nivel);
    } catch (erro) {
      if (erro instanceof ErroAutenticacao) return c.json({ txMensagem: erro.message }, erro.status);
      throw erro;
    }
    return next();
  });

  base.get("/modelos", c => c.json({ modelos: listarModelos(dep.provedores), nivel: c.get("nivel") }));

  base.get("/conversas", async c => c.json({ conversas: await dep.repositorio.listar(c.get("usuario").id) }));

  base.get("/conversas/:id", async c => {
    const id = idDaRota(c);
    if (!id) return c.json({ txMensagem: "Conversa inválida." }, 400);
    const mensagens = await dep.repositorio.mensagens(c.get("usuario").id, id);
    if (!mensagens) return c.json({ txMensagem: "Conversa não encontrada." }, 404);
    return c.json({
      mensagens: mensagens.map(m => ({ papel: m.papel, provedor: m.provedor, partes: partesParaTela(m.partes) })),
    });
  });

  base.patch("/conversas/:id", async c => {
    const id = idDaRota(c);
    const corpo = esquemaTitulo.safeParse(await c.req.json().catch(() => null));
    if (!id || !corpo.success) return c.json({ txMensagem: "Título inválido." }, 400);
    const ok = await dep.repositorio.renomear(c.get("usuario").id, id, corpo.data.titulo);
    return ok ? c.body(null, 204) : c.json({ txMensagem: "Conversa não encontrada." }, 404);
  });

  base.delete("/conversas/:id", async c => {
    const id = idDaRota(c);
    if (!id) return c.json({ txMensagem: "Conversa inválida." }, 400);
    const ok = await dep.repositorio.excluir(c.get("usuario").id, id);
    return ok ? c.body(null, 204) : c.json({ txMensagem: "Conversa não encontrada." }, 404);
  });

  base.post("/chat", async c => {
    const usuario = c.get("usuario");
    const corpo = esquemaChat.safeParse(await c.req.json().catch(() => null));
    if (!corpo.success) return c.json({ txMensagem: "Pedido inválido." }, 400);
    const { modelo, texto, anexos } = corpo.data;

    const provedor = provedorDoModelo(dep.provedores, modelo);
    if (!provedor) return c.json({ txMensagem: "Modelo indisponível." }, 400);

    const convertidos = anexosParaPartes(anexos, dep.config.anexoMaxBytes);
    if ("erro" in convertidos) return c.json({ txMensagem: convertidos.erro }, 400);
    const partes: Parte[] = [...convertidos.partes];
    if (texto.trim()) partes.push({ tipo: "texto", texto });
    if (partes.length === 0) return c.json({ txMensagem: "Escreva uma mensagem ou anexe um arquivo." }, 400);

    let idConversa = corpo.data.idConversa;
    let historico: Mensagem[] = [];
    if (idConversa) {
      const anteriores = await dep.repositorio.mensagens(usuario.id, idConversa);
      if (!anteriores) return c.json({ txMensagem: "Conversa não encontrada." }, 404);
      historico = anteriores;
    } else {
      idConversa = await dep.repositorio.criar(usuario.id, tituloInicial(texto, partes));
    }
    const conversa = idConversa;

    const daVez: Mensagem = { papel: "usuario", partes };
    await dep.repositorio.adicionar(conversa, { papel: "usuario", partes });
    historico = [...historico, daVez];

    return streamSSE(c, async sse => {
      await sse.writeSSE({ event: "conversa", data: JSON.stringify({ id: conversa }) });
      let resposta = "";
      let salvo = false;
      const salvar = async (extra: { nativo?: unknown; uso?: { entrada: number; saida: number } } = {}) => {
        if (salvo || (!resposta && extra.nativo === undefined)) return;
        salvo = true;
        await dep.repositorio.adicionar(conversa, {
          papel: "assistente",
          partes: [{ tipo: "texto", texto: resposta }],
          provedor: provedor.id,
          modelo,
          ...extra,
        });
      };
      // Se a pessoa fechar a tela no meio, guarda o que já chegou.
      sse.onAbort(() => {
        void salvar();
      });

      for await (const evento of provedor.conversar({
        modelo,
        sistema: promptSistema(usuario),
        historico,
        sinal: c.req.raw.signal,
      })) {
        if (evento.tipo === "texto") {
          resposta += evento.delta;
          await sse.writeSSE({ event: "texto", data: JSON.stringify({ delta: evento.delta }) });
        } else if (evento.tipo === "fim") {
          await salvar({ nativo: evento.nativo, uso: evento.uso });
          await sse.writeSSE({ event: "fim", data: JSON.stringify({ motivo: evento.motivo, uso: evento.uso }) });
        } else {
          await salvar();
          await sse.writeSSE({ event: "erro", data: JSON.stringify({ mensagem: evento.mensagem }) });
        }
      }
    });
  });

  app.onError((erro, c) => {
    console.error("[lugia] erro não tratado:", erro instanceof Error ? erro.message : erro);
    return c.json({ txMensagem: "Erro interno na Lugia." }, 500);
  });

  return app;
}

function idDaRota(c: Context): number | null {
  const id = Number(c.req.param("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}
