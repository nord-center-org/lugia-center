import assert from "node:assert/strict";
import { test } from "node:test";
import { anexosParaPartes, bytesBase64, MAX_ANEXOS } from "../src/anexos.ts";

const MB = 1024 * 1024;

test("bytesBase64 desconta o preenchimento", () => {
  assert.equal(bytesBase64(Buffer.from("abc").toString("base64")), 3);
  assert.equal(bytesBase64(Buffer.from("ab").toString("base64")), 2);
  assert.equal(bytesBase64(Buffer.from("a").toString("base64")), 1);
});

test("aceita imagem e PDF, removendo o prefixo data URL", () => {
  const r = anexosParaPartes(
    [
      { mime: "image/jpeg", base64: "data:image/jpeg;base64,AAAA", nome: "a.jpg" },
      { mime: "application/pdf", base64: "BBBB" },
    ],
    MB,
  );
  assert.ok("partes" in r);
  assert.deepEqual(r.partes, [
    { tipo: "imagem", mime: "image/jpeg", base64: "AAAA", nome: "a.jpg" },
    { tipo: "pdf", base64: "BBBB", nome: undefined },
  ]);
});

test("recusa tipo não suportado, base64 inválido, excesso e tamanho", () => {
  assert.ok("erro" in anexosParaPartes([{ mime: "text/html", base64: "AAAA" }], MB));
  assert.ok("erro" in anexosParaPartes([{ mime: "image/png", base64: "não é base64" }], MB));
  const muitos = Array.from({ length: MAX_ANEXOS + 1 }, () => ({ mime: "image/png", base64: "AAAA" }));
  assert.ok("erro" in anexosParaPartes(muitos, MB));
  assert.ok("erro" in anexosParaPartes([{ mime: "image/png", base64: "A".repeat(2000) }], 1000));
});
