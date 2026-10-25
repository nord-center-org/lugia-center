/**
 * Formato neutro de conversa: o mesmo histórico serve para Claude, ChatGPT e Gemini.
 * Cada provedor converte daqui para o formato da sua API.
 */

export type IdProvedor = "claude" | "openai" | "gemini";

export type Parte =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem"; mime: string; base64: string; nome?: string }
  | { tipo: "pdf"; base64: string; nome?: string };

export interface Mensagem {
  papel: "usuario" | "assistente";
  partes: Parte[];
  /** Provedor que gerou a resposta (só no assistente). */
  provedor?: IdProvedor;
  /**
   * Conteúdo original da resposta no formato do provedor (ex.: blocos do Claude, com thinking).
   * Reenviado sem alteração quando a conversa continua no mesmo provedor.
   */
  nativo?: unknown;
}

export interface Modelo {
  provedor: IdProvedor;
  id: string;
  nome: string;
}

export interface PedidoChat {
  modelo: string;
  sistema: string;
  historico: Mensagem[];
  sinal?: AbortSignal;
}

export type EventoChat =
  | { tipo: "texto"; delta: string }
  | { tipo: "fim"; motivo: string; nativo?: unknown; uso?: { entrada: number; saida: number } }
  | { tipo: "erro"; mensagem: string };
