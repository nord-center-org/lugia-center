import OpenAI from "openai";
import type { EventoChat, Mensagem, PedidoChat } from "../tipos.ts";
import { somenteTexto, type Provedor } from "./provedor.ts";

type Entrada = OpenAI.Responses.ResponseInputItem;
type Conteudo = OpenAI.Responses.ResponseInputMessageContentList[number];

/** Converte o histórico neutro para a Responses API. Pura, para testar sem rede. */
export function paraOpenAI(historico: Mensagem[]): Entrada[] {
  return historico.map(m => {
    if (m.papel === "assistente") {
      return { role: "assistant", content: somenteTexto(m.partes) || "…" };
    }
    const conteudo: Conteudo[] = [];
    for (const p of m.partes) {
      if (p.tipo === "imagem") {
        conteudo.push({ type: "input_image", detail: "auto", image_url: `data:${p.mime};base64,${p.base64}` });
      } else if (p.tipo === "pdf") {
        conteudo.push({
          type: "input_file",
          filename: p.nome ?? "documento.pdf",
          file_data: `data:application/pdf;base64,${p.base64}`,
        });
      }
    }
    for (const p of m.partes) {
      if (p.tipo === "texto" && p.texto.trim()) conteudo.push({ type: "input_text", text: p.texto });
    }
    if (conteudo.length === 0) conteudo.push({ type: "input_text", text: "…" });
    return { role: "user", content: conteudo };
  });
}

export function criarOpenAI(apiKey: string, modelos: string[]): Provedor {
  const client = new OpenAI({ apiKey });
  return {
    id: "openai",
    nome: "ChatGPT",
    modelos,
    async *conversar(pedido: PedidoChat): AsyncIterable<EventoChat> {
      try {
        const stream = await client.responses.create(
          { model: pedido.modelo, instructions: pedido.sistema, input: paraOpenAI(pedido.historico), stream: true },
          { signal: pedido.sinal },
        );
        for await (const evento of stream) {
          if (evento.type === "response.output_text.delta") {
            yield { tipo: "texto", delta: evento.delta };
          } else if (evento.type === "response.completed") {
            const uso = evento.response.usage;
            yield {
              tipo: "fim",
              motivo: evento.response.status ?? "completed",
              uso: uso ? { entrada: uso.input_tokens, saida: uso.output_tokens } : undefined,
            };
            return;
          } else if (evento.type === "response.failed") {
            yield { tipo: "erro", mensagem: evento.response.error?.message ?? "O ChatGPT não conseguiu responder." };
            return;
          } else if (evento.type === "error") {
            yield { tipo: "erro", mensagem: evento.message };
            return;
          }
        }
        yield { tipo: "fim", motivo: "incompleto" };
      } catch (erro) {
        yield { tipo: "erro", mensagem: mensagemErro(erro) };
      }
    },
  };
}

function mensagemErro(erro: unknown): string {
  if (erro instanceof OpenAI.RateLimitError) return "Limite de uso do ChatGPT atingido; tente em instantes.";
  if (erro instanceof OpenAI.AuthenticationError) return "Chave da OpenAI inválida no servidor.";
  if (erro instanceof OpenAI.BadRequestError) return `Pedido recusado pelo ChatGPT: ${erro.message}`;
  if (erro instanceof OpenAI.APIError) return `Falha no ChatGPT (${erro.status ?? "rede"}).`;
  if (erro instanceof Error && erro.name === "AbortError") return "Resposta cancelada.";
  return "Falha inesperada ao falar com o ChatGPT.";
}
