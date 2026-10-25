import type { Config } from "../config.ts";
import type { Modelo } from "../tipos.ts";
import { criarClaude } from "./claude.ts";
import { criarGemini } from "./gemini.ts";
import { criarOpenAI } from "./openai.ts";
import type { Provedor } from "./provedor.ts";

/** Um provedor só fica disponível com chave de API e ao menos um modelo configurado. */
export function criarProvedores(config: Config): Provedor[] {
  const { chaves, modelos } = config;
  const provedores: Provedor[] = [];
  if (chaves.claude && modelos.claude.length) provedores.push(criarClaude(chaves.claude, modelos.claude));
  if (chaves.openai && modelos.openai.length) provedores.push(criarOpenAI(chaves.openai, modelos.openai));
  if (chaves.gemini && modelos.gemini.length) provedores.push(criarGemini(chaves.gemini, modelos.gemini));
  return provedores;
}

export function listarModelos(provedores: Provedor[]): Modelo[] {
  return provedores.flatMap(p => p.modelos.map(id => ({ provedor: p.id, id, nome: `${p.nome} · ${id}` })));
}

export function provedorDoModelo(provedores: Provedor[], modelo: string): Provedor | undefined {
  return provedores.find(p => p.modelos.includes(modelo));
}
