import { NomeEstrategia } from '../../../domain/enums/nome-estrategia.js';
import { mediaBayesiana, normalizarCusto } from '../pontuacao.js';
import { RecomendadorBase, type ComponentesPontuacao } from './recomendador-base.js';
import type { ContextoRecomendacao } from '../contexto-recomendacao.js';
import type { ParametrosRecomendacao } from '../parametros-recomendacao.js';
import type { Profissional } from '../../../domain/entities/profissional.js';

export class EstrategiaFiltragemColaborativa extends RecomendadorBase {
  readonly nome = NomeEstrategia.FILTRAGEM_COLABORATIVA;

  protected calcularComponentes(
    profissional: Profissional,
    contexto: ContextoRecomendacao,
  ): Record<string, number> {
    const desejado = contexto.papel.competenciasDesejadas;
    return {
      colaborativa: mediaBayesiana(profissional.mediaAvaliacoes, profissional.totalAvaliacoes),
      afinidade: contexto.afinidadeMediaComEquipe(profissional.id),
      competencia: desejado.similaridadeCosseno(profissional.competencias),
      custo: normalizarCusto(profissional.custoMedio(), contexto.orcamentoDisponivel),
      localizacao: contexto.projeto.localizacaoFiltragens.afinidadeCom(profissional.localizacao),
    };
  }

  protected calcularPontuacao(
    componentes: ComponentesPontuacao,
    parametros: ParametrosRecomendacao,
  ): number {
    return (
      parametros.pesoCompetencia * componentes.competencia +
      parametros.pesoAvaliacao * componentes.colaborativa +
      parametros.pesoAfinidade * componentes.afinidade +
      parametros.pesoCusto * componentes.custo +
      parametros.pesoLocalizacao * componentes.localizacao
    );
  }
}
