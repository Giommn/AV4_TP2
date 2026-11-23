import { NomeEstrategia } from '../../../domain/enums/nome-estrategia.js';
import { normalizarCusto } from '../pontuacao.js';
import { RecomendadorBase, type ComponentesPontuacao } from './recomendador-base.js';
import type { ContextoRecomendacao } from '../contexto-recomendacao.js';
import type { ParametrosRecomendacao } from '../parametros-recomendacao.js';
import type { Profissional } from '../../../domain/entities/profissional.js';

export class EstrategiaOrcamentoReduzido extends RecomendadorBase {
  readonly nome = NomeEstrategia.ORCAMENTO_REDUZIDO;

  protected calcularComponentes(
    profissional: Profissional,
    contexto: ContextoRecomendacao,
  ): Record<string, number> {
    const desejado = contexto.papel.competenciasDesejadas;
    return {
      custo: normalizarCusto(profissional.custoMedio(), contexto.orcamentoDisponivel),
      competencia: desejado.similaridadeCosseno(profissional.competencias),
      avaliacao: profissional.notaNormalizada(),
    };
  }

  protected calcularPontuacao(
    componentes: ComponentesPontuacao,
    _parametros: ParametrosRecomendacao,
  ): number {
    return 0.5 * componentes.custo + 0.3 * componentes.competencia + 0.2 * componentes.avaliacao;
  }
}
