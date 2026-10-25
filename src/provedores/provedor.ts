import type { EventoChat, IdProvedor, PedidoChat } from "../tipos.ts";

export interface Provedor {
  id: IdProvedor;
  /** Nome exibido no seletor. */
  nome: string;
  modelos: string[];
  conversar(pedido: PedidoChat): AsyncIterable<EventoChat>;
}

/** Texto de todas as partes de texto, para provedores que recebem o histórico de outro. */
export function somenteTexto(partes: { tipo: string; texto?: string }[]): string {
  return partes.filter(p => p.tipo === "texto").map(p => p.texto ?? "").join("\n");
}
