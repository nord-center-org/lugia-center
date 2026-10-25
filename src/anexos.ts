import { z } from "zod";
import type { Parte } from "./tipos.ts";

export const MIMES_IMAGEM = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_ANEXOS = 5;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const esquemaAnexo = z.object({
  nome: z.string().max(200).optional(),
  mime: z.string(),
  base64: z.string().min(1),
});

export type Anexo = z.infer<typeof esquemaAnexo>;

/** Bytes reais de um base64 (sem decodificar). */
export function bytesBase64(base64: string): number {
  const preenchimento = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - preenchimento;
}

/** Valida e converte anexos em partes; devolve a mensagem de erro em português, se houver. */
export function anexosParaPartes(anexos: Anexo[], maxBytes: number): { partes: Parte[] } | { erro: string } {
  if (anexos.length > MAX_ANEXOS) return { erro: `Envie no máximo ${MAX_ANEXOS} anexos por mensagem.` };
  const partes: Parte[] = [];
  for (const anexo of anexos) {
    const rotulo = anexo.nome ?? "anexo";
    const base64 = anexo.base64.replace(/^data:[^;]+;base64,/, "");
    if (!BASE64.test(base64)) return { erro: `${rotulo}: conteúdo inválido.` };
    if (bytesBase64(base64) > maxBytes) {
      return { erro: `${rotulo}: maior que ${Math.round(maxBytes / 1024 / 1024)} MB.` };
    }
    if ((MIMES_IMAGEM as readonly string[]).includes(anexo.mime)) {
      partes.push({ tipo: "imagem", mime: anexo.mime, base64, nome: anexo.nome });
    } else if (anexo.mime === "application/pdf") {
      partes.push({ tipo: "pdf", base64, nome: anexo.nome });
    } else {
      return { erro: `${rotulo}: tipo não suportado (use PNG, JPEG, WEBP, GIF ou PDF).` };
    }
  }
  return { partes };
}
