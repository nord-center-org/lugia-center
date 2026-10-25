import assert from "node:assert/strict";
import { test } from "node:test";
import { atende, criarAutenticador, ErroAutenticacao, extrairToken, nivelLugia } from "../src/nordtool/autenticacao.ts";

const usuario = { id: 7, nome: "Ana", email: "ana@nord", perfil: "USER", permissoes: [{ cdModulo: "LUGIA", cdAcao: "ESCRITA" }] };

test("nível da Lugia vem das permissões efetivas", () => {
  assert.equal(nivelLugia(usuario.permissoes), "ESCRITA");
  assert.equal(nivelLugia([{ cdModulo: "FINANCEIRO", cdAcao: "ADMIN" }]), "NENHUM");
  assert.equal(nivelLugia([{ cdModulo: "LUGIA", cdAcao: "QUALQUER" }]), "NENHUM");
  assert.ok(atende("ESCRITA", "LEITURA"));
  assert.ok(!atende("LEITURA", "ESCRITA"));
});

test("extrairToken aceita só Bearer", () => {
  assert.equal(extrairToken("Bearer abc.def"), "abc.def");
  assert.equal(extrairToken("Basic abc"), null);
  assert.equal(extrairToken(undefined), null);
});

test("autenticador consulta /auth/me e guarda em cache pelo TTL", async () => {
  let chamadas = 0;
  let agora = 0;
  const buscar = (async (url: string, init: RequestInit) => {
    chamadas++;
    assert.equal(url, "http://api/api/v1/nord-tool/auth/me");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tk");
    return new Response(JSON.stringify({ body: usuario }), { status: 200 });
  }) as typeof fetch;
  const autenticar = criarAutenticador("http://api", buscar, 1000, () => agora);
  assert.deepEqual(await autenticar("tk"), usuario);
  await autenticar("tk");
  assert.equal(chamadas, 1);
  agora = 2000;
  await autenticar("tk");
  assert.equal(chamadas, 2);
});

test("autenticador traduz 401 do backend e falha de rede", async () => {
  const negado = criarAutenticador("http://api", (async () => new Response("", { status: 401 })) as typeof fetch);
  await assert.rejects(negado("x"), (e: unknown) => e instanceof ErroAutenticacao && e.status === 401);
  const fora = criarAutenticador("http://api", (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch);
  await assert.rejects(fora("x"), (e: unknown) => e instanceof ErroAutenticacao && e.status === 502);
});
