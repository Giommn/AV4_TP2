import type { Profissional } from '../../../domain/entities/profissional.js';
import type { NomeEstrategia } from '../../../domain/enums/nome-estrategia.js';
import { CandidatoRanqueado } from '../candidato-ranqueado.js';
import type { ContextoRecomendacao } from '../contexto-recomendacao.js';
import type { ParametrosRecomendacao } from '../parametros-recomendacao.js';
import type { RecomendacaoStrategy } from './recomendacao-strategy.js';

export type ComponentesPontuacao = Readonly<Record<string, number>>;

/**
 * Concentra o fluxo principal de recomendação (percorrer candidatos, calcular
 * componentes e pontuação e empacotar o resultado). Cada estratégia concreta
 * define apenas a fórmula que distingue seu comportamento.
 */
export abstract class RecomendadorBase implements RecomendacaoStrategy {
  abstract readonly nome: NomeEstrategia;

  recomendar(
    candidatos: readonly Profissional[],
    contexto: ContextoRecomendacao,
    parametros: ParametrosRecomendacao,
  ): CandidatoRanqueado[] {
    return candidatos.map((profissional) => {
      const componentes = this.calcularComponentes(profissional, contexto);
      const pontuacao = this.calcularPontuacao(componentes, parametros);
      return new CandidatoRanqueado(profissional, pontuacao, { ...componentes });
    });
  }

  protected abstract calcularComponentes(
    profissional: Profissional,
    contexto: ContextoRecomendacao,
  ): Record<string, number>;

  protected abstract calcularPontuacao(
    componentes: ComponentesPontuacao,
    parametros: ParametrosRecomendacao,
  ): number;
}
