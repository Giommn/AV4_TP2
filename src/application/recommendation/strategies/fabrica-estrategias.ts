import { NomeEstrategia } from '../../../domain/enums/nome-estrategia.js';
import { ErroNegocio } from '../../erros.js';
import { EstrategiaSimilaridadeCosseno } from './similaridade-cosseno.js';
import { EstrategiaFiltragemColaborativa } from './filtragem-colaborativa.js';
import { EstrategiaOrcamentoReduzido } from './orcamento-reduzido.js';
import type { RecomendacaoStrategy } from './recomendacao-strategy.js';

const CRIADORES: Readonly<Record<NomeEstrategia, () => RecomendacaoStrategy>> = {
  [NomeEstrategia.SIMILARIDADE_COSSENO]: () => new EstrategiaSimilaridadeCosseno(),
  [NomeEstrategia.FILTRAGEM_COLABORATIVA]: () => new EstrategiaFiltragemColaborativa(),
  [NomeEstrategia.ORCAMENTO_REDUZIDO]: () => new EstrategiaOrcamentoReduzido(),
};

export function criarEstrategia(nome: NomeEstrategia): RecomendacaoStrategy {
  const criador = CRIADORES[nome];
  if (!criador) {
    throw new ErroNegocio(`Estrategia de recomendacao desconhecida: ${nome}`);
  }
  return criador();
}
