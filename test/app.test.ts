import assert from "node:assert/strict";
import { test } from "node:test";
import { criarApp, partesParaTela, tituloInicial } from "../src/app.ts";
import type { NovaMensagem, RepositorioConversas } from "../src/conversas/repositorio.ts";
import type { UsuarioNord } from "../src/nordtool/autenticacao.ts";
import type { Provedor } from "../src/provedores/provedor.ts";
import type { Mensagem, PedidoChat } from "../src/tipos.ts";

function repositorioEmMemoria() {
  const conversas = new Map<number, { dono: number; titulo: string; mensagens: Mensagem[] }>();
  let seq = 0;
  const repo: RepositorioConversas = {
    async listar(dono) {
      return [...conversas.entries()]
        .filter(([, c]) => c.dono === dono)
        .map(([id, c]) => ({ id, titulo: c.titulo, atualizadaEm: "2026-01-01T00:00:00.000Z" }));
    },
    async criar(dono, titulo) {
      conversas.set(++seq, { dono, titulo, mensagens: [] });
      return seq;
    },
    async mensagens(dono, id) {
      const c = conversas.get(id);
      return c && c.dono === dono ? structuredClone(c.mensagens) : null;
    },
    async adicionar(id, m: NovaMensagem) {
      conversas.get(id)!.mensagens.push({ papel: m.papel, partes: m.partes, provedor: m.provedor, nativo: m.nativo });
    },
    async renomear(dono, id, titulo) {
      const c = conversas.get(id);
      if (!c || c.dono !== dono) return false;
      c.titulo = titulo;
      return true;
    },
    async excluir(dono, id) {
      const c = conversas.get(id);
      return !!c && c.dono === dono && conversas.delete(id);
    },
  };
  return { repo, conversas };
}

function provedorFalso(pedidos: PedidoChat[]): Provedor {
  return {
    id: "claude",
    nome: "Claude",
    modelos: ["claude-opus-5-5"],
    async *conversar(pedido) {
      pedidos.push(pedido);
      yield { tipo: "texto", delta: "Olá, " };
      yield { tipo: "texto", delta: "Ana!" };
      yield { tipo: "fim", motivo: "end_turn", nativo: [{ type: "text", text: "Olá, Ana!" }], uso: { entrada: 10, saida: 3 } };
    },
  };
}

const usuarios: Record<string, UsuarioNord> = {
  ana: { id: 1, nome: "Ana", email: "a@n", perfil: "USER", permissoes: [{ cdModulo: "LUGIA", cdAcao: "LEITURA" }] },
  bia: { id: 2, nome: "Bia", email: "b@n", perfil: "USER", permissoes: [{ cdModulo: "FINANCEIRO", cdAcao: "ESCRITA" }] },
};

function montar() {
  const pedidos: PedidoChat[] = [];
  const { repo, conversas } = repositorioEmMemoria();
  const app = criarApp({
    config: { origens: ["http://localhost:5173"], anexoMaxBytes: 1024 * 1024 },
    provedores: [provedorFalso(pedidos)],
    repositorio: repo,
    autenticar: async token => {
      const u = usuarios[token];
      if (!u) throw new (await import("../src/nordtool/autenticacao.ts")).ErroAutenticacao(401, "Sessão inválida.");
      return u;
    },
  });
  const chamar = (caminho: string, token: string | null, init: RequestInit = {}) =>
    app.request(`/api/v1/lugia${caminho}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  return { chamar, pedidos, conversas };
}

test("exige login e permissão LUGIA", async () => {
  const { chamar } = montar();
  assert.equal((await chamar("/modelos", null)).status, 401);
  assert.equal((await chamar("/modelos", "desconhecido")).status, 401);
  assert.equal((await chamar("/modelos", "bia")).status, 403);
  const ok = await chamar("/modelos", "ana");
  assert.equal(ok.status, 200);
  assert.deepEqual(((await ok.json()) as { modelos: unknown }).modelos, [{ provedor: "claude", id: "claude-opus-5-5", nome: "Claude · claude-opus-5-5" }]);
  assert.equal((await chamar("/saude", null)).status, 200);
});

test("chat transmite a resposta por SSE e grava o histórico com o conteúdo nativo", async () => {
  const { chamar, pedidos, conversas } = montar();
  const r = await chamar("/chat", "ana", {
    method: "POST",
    body: JSON.stringify({ modelo: "claude-opus-5-5", texto: "Oi Lugia" }),
  });
  assert.equal(r.status, 200);
  const sse = await r.text();
  assert.match(sse, /event: conversa\ndata: \{"id":1\}/);
  assert.match(sse, /event: texto\ndata: \{"delta":"Olá, "\}/);
  assert.match(sse, /event: fim/);

  const conversa = conversas.get(1)!;
  assert.equal(conversa.titulo, "Oi Lugia");
  assert.equal(conversa.mensagens.length, 2);
  assert.deepEqual(conversa.mensagens[1].partes, [{ tipo: "texto", texto: "Olá, Ana!" }]);
  assert.deepEqual(conversa.mensagens[1].nativo, [{ type: "text", text: "Olá, Ana!" }]);
  assert.match(pedidos[0].sistema, /Ana/);

  // Segunda mensagem leva o histórico completo ao provedor.
  await (await chamar("/chat", "ana", { method: "POST", body: JSON.stringify({ idConversa: 1, modelo: "claude-opus-5-5", texto: "E aí?" }) })).text();
  assert.equal(pedidos[1].historico.length, 3);
  assert.equal(pedidos[1].historico[1].provedor, "claude");
});

test("chat recusa modelo desconhecido, anexo inválido e conversa de outra pessoa", async () => {
  const { chamar } = montar();
  const post = (corpo: object, token = "ana") => chamar("/chat", token, { method: "POST", body: JSON.stringify(corpo) });
  assert.equal((await post({ modelo: "gpt-x", texto: "oi" })).status, 400);
  assert.equal((await post({ modelo: "claude-opus-5-5", anexos: [{ mime: "text/html", base64: "AAAA" }] })).status, 400);
  assert.equal((await post({ modelo: "claude-opus-5-5", texto: "  " })).status, 400);
  assert.equal((await post({ idConversa: 99, modelo: "claude-opus-5-5", texto: "oi" })).status, 404);
});

test("listar, renomear e excluir só as conversas do próprio usuário", async () => {
  const { chamar } = montar();
  await (await chamar("/chat", "ana", { method: "POST", body: JSON.stringify({ modelo: "claude-opus-5-5", texto: "Oi" }) })).text();
  assert.equal(((await (await chamar("/conversas", "ana")).json()) as { conversas: unknown[] }).conversas.length, 1);
  const detalhe = (await (await chamar("/conversas/1", "ana")).json()) as { mensagens: unknown[] };
  assert.equal(detalhe.mensagens.length, 2);
  assert.equal((await chamar("/conversas/1", "ana", { method: "PATCH", body: JSON.stringify({ titulo: "Novo" }) })).status, 204);
  assert.equal((await chamar("/conversas/1", "ana", { method: "DELETE" })).status, 204);
  assert.equal((await chamar("/conversas/1", "ana")).status, 404);
});

test("títulos e partes para a tela", () => {
  assert.equal(tituloInicial("  oi   lugia ", []), "oi lugia");
  assert.equal(tituloInicial("x".repeat(80), []).length, 60);
  assert.equal(tituloInicial("", [{ tipo: "pdf", base64: "A", nome: "termo.pdf" }]), "termo.pdf");
  assert.deepEqual(partesParaTela([{ tipo: "imagem", mime: "image/png", base64: "AAAA", nome: "f.png" }]), [
    { tipo: "imagem", nome: "f.png", mime: "image/png" },
  ]);
});
