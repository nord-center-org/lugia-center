import assert from "node:assert/strict";
import { test } from "node:test";
import { paraClaude } from "../src/provedores/claude.ts";
import { paraGemini } from "../src/provedores/gemini.ts";
import { paraOpenAI } from "../src/provedores/openai.ts";
import type { Mensagem } from "../src/tipos.ts";

const historico: Mensagem[] = [
  {
    papel: "usuario",
    partes: [
      { tipo: "texto", texto: "Analise" },
      { tipo: "imagem", mime: "image/png", base64: "AAAA", nome: "foto.png" },
      { tipo: "pdf", base64: "BBBB", nome: "termo.pdf" },
    ],
  },
  {
    papel: "assistente",
    provedor: "claude",
    partes: [{ tipo: "texto", texto: "Feito" }],
    nativo: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Feito" }],
  },
  { papel: "assistente", provedor: "openai", partes: [{ tipo: "texto", texto: "Do GPT" }] },
];

test("Claude: anexos antes do texto e resposta própria reenviada sem alteração", () => {
  const msgs = paraClaude(historico);
  const usuario = msgs[0].content as Array<{ type: string }>;
  assert.deepEqual(usuario.map(b => b.type), ["image", "document", "text"]);
  assert.deepEqual(msgs[1].content, historico[1].nativo);
  assert.equal(msgs[2].content, "Do GPT");
});

test("Claude: mensagem sem conteúdo não vira bloco vazio", () => {
  const msgs = paraClaude([{ papel: "usuario", partes: [{ tipo: "texto", texto: "  " }] }]);
  assert.deepEqual(msgs[0].content, [{ type: "text", text: "…" }]);
});

test("OpenAI: imagem e PDF como data URL", () => {
  const [usuario, claude] = paraOpenAI(historico) as Array<{ role: string; content: unknown }>;
  const partes = usuario.content as Array<Record<string, string>>;
  assert.equal(partes[0].type, "input_image");
  assert.equal(partes[0].image_url, "data:image/png;base64,AAAA");
  assert.equal(partes[1].type, "input_file");
  assert.equal(partes[1].file_data, "data:application/pdf;base64,BBBB");
  assert.equal(partes[2].type, "input_text");
  // Resposta de outro provedor chega só como texto.
  assert.deepEqual(claude, { role: "assistant", content: "Feito" });
});

test("Gemini: papel model e inlineData", () => {
  const [usuario, resposta] = paraGemini(historico);
  assert.equal(usuario.role, "user");
  assert.deepEqual(usuario.parts?.[0], { inlineData: { mimeType: "image/png", data: "AAAA" } });
  assert.deepEqual(usuario.parts?.[2], { text: "Analise" });
  assert.deepEqual(resposta, { role: "model", parts: [{ text: "Feito" }] });
});
