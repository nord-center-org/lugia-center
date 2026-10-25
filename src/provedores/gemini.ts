import { ApiError, GoogleGenAI, type Content, type Part } from "@google/genai";
import type { EventoChat, Mensagem, PedidoChat } from "../tipos.ts";
import { somenteTexto, type Provedor } from "./provedor.ts";

/** Converte o histórico neutro para `contents` do Gemini. Pura, para testar sem rede. */
export function paraGemini(historico: Mensagem[]): Content[] {
  return historico.map(m => {
    if (m.papel === "assistente") {
      return { role: "model", parts: [{ text: somenteTexto(m.partes) || "…" }] };
    }
    const parts: Part[] = [];
    for (const p of m.partes) {
      if (p.tipo === "imagem") parts.push({ inlineData: { mimeType: p.mime, data: p.base64 } });
      else if (p.tipo === "pdf") parts.push({ inlineData: { mimeType: "application/pdf", data: p.base64 } });
    }
    for (const p of m.partes) {
      if (p.tipo === "texto" && p.texto.trim()) parts.push({ text: p.texto });
    }
    if (parts.length === 0) parts.push({ text: "…" });
    return { role: "user", parts };
  });
}

export function criarGemini(apiKey: string, modelos: string[]): Provedor {
  const ai = new GoogleGenAI({ apiKey });
  return {
    id: "gemini",
    nome: "Gemini",
    modelos,
    async *conversar(pedido: PedidoChat): AsyncIterable<EventoChat> {
      try {
        const stream = await ai.models.generateContentStream({
          model: pedido.modelo,
          contents: paraGemini(pedido.historico),
          config: { systemInstruction: pedido.sistema, abortSignal: pedido.sinal },
        });
        let motivo = "STOP";
        let uso: { entrada: number; saida: number } | undefined;
        for await (const parte of stream) {
          const texto = parte.text;
          if (texto) yield { tipo: "texto", delta: texto };
          motivo = parte.candidates?.[0]?.finishReason ?? motivo;
          const meta = parte.usageMetadata;
          if (meta) uso = { entrada: meta.promptTokenCount ?? 0, saida: meta.candidatesTokenCount ?? 0 };
        }
        yield { tipo: "fim", motivo, uso };
      } catch (erro) {
        yield { tipo: "erro", mensagem: mensagemErro(erro) };
      }
    },
  };
}

function mensagemErro(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.status === 429) return "Limite de uso do Gemini atingido; tente em instantes.";
    if (erro.status === 401 || erro.status === 403) return "Chave do Gemini inválida no servidor.";
    if (erro.status === 400) return `Pedido recusado pelo Gemini: ${erro.message}`;
    return `Falha no Gemini (${erro.status}).`;
  }
  if (erro instanceof Error && erro.name === "AbortError") return "Resposta cancelada.";
  return "Falha inesperada ao falar com o Gemini.";
}
