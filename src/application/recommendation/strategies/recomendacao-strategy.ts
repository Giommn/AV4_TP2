import type { Profissional } from '../../../domain/entities/profissional.js';
import type { NomeEstrategia } from '../../../domain/enums/nome-estrategia.js';
import type { ContextoRecomendacao } from '../contexto-recomendacao.js';
import type { ParametrosRecomendacao } from '../parametros-recomendacao.js';
import type { CandidatoRanqueado } from '../candidato-ranqueado.js';

/** Contrato mantido para todas as estratégias e decoradores de recomendação. */
export interface RecomendacaoStrategy {
  readonly nome: NomeEstrategia;
  recomendar(
    candidatos: readonly Profissional[],
    contexto: ContextoRecomendacao,
    parametros: ParametrosRecomendacao,
  ): CandidatoRanqueado[];
}
