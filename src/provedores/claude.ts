import Anthropic from "@anthropic-ai/sdk";
import type { EventoChat, Mensagem, PedidoChat } from "../tipos.ts";
import { somenteTexto, type Provedor } from "./provedor.ts";

type BlocoUsuario = Anthropic.Beta.Messages.BetaContentBlockParam;

/** Modelos que aceitam `fallbacks: "default"` (re-execução automática se o modelo recusar). */
const COM_FALLBACK = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** Converte o histórico neutro para mensagens do Claude. Pura, para testar sem rede. */
export function paraClaude(historico: Mensagem[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  return historico.map(m => {
    if (m.papel === "assistente") {
      // Resposta do próprio Claude volta sem alteração (inclusive thinking); de outro provedor, só o texto.
      if (m.provedor === "claude" && Array.isArray(m.nativo) && m.nativo.length > 0) {
        return { role: "assistant", content: m.nativo as Anthropic.Beta.Messages.BetaContentBlockParam[] };
      }
      return { role: "assistant", content: somenteTexto(m.partes) || "…" };
    }
    const blocos: BlocoUsuario[] = [];
    for (const p of m.partes) {
      if (p.tipo === "imagem") {
        blocos.push({
          type: "image",
          source: { type: "base64", media_type: p.mime as "image/png", data: p.base64 },
        });
      } else if (p.tipo === "pdf") {
        blocos.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: p.base64 },
          ...(p.nome ? { title: p.nome } : {}),
        });
      }
    }
    // Anexos antes do texto, como recomenda a documentação.
    for (const p of m.partes) {
      if (p.tipo === "texto" && p.texto.trim()) blocos.push({ type: "text", text: p.texto });
    }
    if (blocos.length === 0) blocos.push({ type: "text", text: "…" });
    return { role: "user", content: blocos };
  });
}

export function criarClaude(apiKey: string, modelos: string[]): Provedor {
  const client = new Anthropic({ apiKey });
  return {
    id: "claude",
    nome: "Claude",
    modelos,
    async *conversar(pedido: PedidoChat): AsyncIterable<EventoChat> {
      const comFallback = COM_FALLBACK.has(pedido.modelo);
      try {
        const stream = client.beta.messages.stream(
          {
            model: pedido.modelo,
            max_tokens: 64000,
            system: pedido.sistema,
            messages: paraClaude(pedido.historico),
            // Thinking adaptativo; se um bloco antigo não casar com o histórico, é descartado em vez de falhar.
            thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
            output_config: { effort: "medium" },
            cache_control: { type: "ephemeral" },
            betas: [
              "thinking-binding-controls-2026-08-01",
              ...(comFallback ? ["server-side-fallback-2026-07-01"] : []),
            ],
            ...(comFallback ? { fallbacks: "default" as const } : {}),
          },
          { signal: pedido.sinal },
        );
        for await (const evento of stream) {
          if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
            yield { tipo: "texto", delta: evento.delta.text };
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          yield { tipo: "texto", delta: "\n\n_(O Claude não pôde responder a este pedido.)_" };
        }
        yield {
          tipo: "fim",
          motivo: final.stop_reason ?? "end_turn",
          nativo: final.content,
          uso: { entrada: final.usage.input_tokens, saida: final.usage.output_tokens },
        };
      } catch (erro) {
        yield { tipo: "erro", mensagem: mensagemErro(erro) };
      }
    },
  };
}

function mensagemErro(erro: unknown): string {
  if (erro instanceof Anthropic.RateLimitError) return "Limite de uso do Claude atingido; tente em instantes.";
  if (erro instanceof Anthropic.AuthenticationError) return "Chave do Claude inválida no servidor.";
  if (erro instanceof Anthropic.BadRequestError) return `Pedido recusado pelo Claude: ${erro.message}`;
  if (erro instanceof Anthropic.APIError) return `Falha no Claude (${erro.status ?? "rede"}).`;
  if (erro instanceof Error && erro.name === "AbortError") return "Resposta cancelada.";
  return "Falha inesperada ao falar com o Claude.";
}
