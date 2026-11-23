import { NomeEstrategia } from '../../domain/enums/nome-estrategia.js';
import { criarEstrategia } from './strategies/fabrica-estrategias.js';
import { PARAMETROS_PADRAO, type ParametrosRecomendacao } from './parametros-recomendacao.js';
import type { RecomendacaoStrategy } from './strategies/recomendacao-strategy.js';
import type { ContextoRecomendacao } from './contexto-recomendacao.js';
import type { CandidatoRanqueado } from './candidato-ranqueado.js';
import type { Profissional } from '../../domain/entities/profissional.js';
import type { Papel } from '../../domain/enums/papel.js';
import { aplicarDecoradores, CacheResultadosRecomendacao, type MetricasDecoradores, type TipoDecoradorRecomendacao } from './strategies/decorators-recomendacao.js';

export class MotorRecomendacao {
  private estrategiaBase: RecomendacaoStrategy;
  private estrategia: RecomendacaoStrategy;
  private parametros: ParametrosRecomendacao;
  private decoradores: TipoDecoradorRecomendacao[];
  private cacheResultados: CacheResultadosRecomendacao;
  private metricas?: MetricasDecoradores;

  constructor(
    estrategia: RecomendacaoStrategy,
    parametros: ParametrosRecomendacao = PARAMETROS_PADRAO,
    decoradores: readonly TipoDecoradorRecomendacao[] = [],
    cacheResultados = new CacheResultadosRecomendacao(),
    metricas?: MetricasDecoradores,
  ) {
    this.estrategiaBase = estrategia;
    this.decoradores = [...decoradores];
    this.cacheResultados = cacheResultados;
    this.metricas = metricas;
    this.estrategia = aplicarDecoradores(estrategia, this.decoradores, this.cacheResultados, this.metricas);
    this.parametros = parametros;
  }

  static padrao(): MotorRecomendacao {
    return new MotorRecomendacao(criarEstrategia(NomeEstrategia.SIMILARIDADE_COSSENO));
  }

  get nomeEstrategia(): NomeEstrategia {
    return this.estrategiaBase.nome;
  }

  get tiposDecoradores(): readonly TipoDecoradorRecomendacao[] { return [...this.decoradores]; }

  get parametrosAtuais(): ParametrosRecomendacao {
    return this.parametros;
  }

  trocarEstrategia(nome: NomeEstrategia): void {
    this.definirEstrategia(criarEstrategia(nome));
  }

  definirEstrategia(estrategia: RecomendacaoStrategy): void {
    this.estrategiaBase = estrategia;
    this.reconstruirPilha();
  }

  configurarDecoradores(
    decoradores: readonly TipoDecoradorRecomendacao[],
    cacheResultados = this.cacheResultados,
    metricas = this.metricas,
  ): void {
    this.decoradores = [...decoradores];
    this.cacheResultados = cacheResultados;
    this.metricas = metricas;
    this.reconstruirPilha();
  }

  trocarParametros(parametros: ParametrosRecomendacao): void {
    this.parametros = parametros;
  }

  private reconstruirPilha(): void {
    this.estrategia = aplicarDecoradores(this.estrategiaBase, this.decoradores, this.cacheResultados, this.metricas);
  }

  recomendar(candidatos: readonly Profissional[], contexto: ContextoRecomendacao): CandidatoRanqueado[] {
    const elegiveis = this.filtrarElegiveis(candidatos, contexto);
    return this.estrategia
      .recomendar(elegiveis, contexto, this.parametros)
      .sort((a, b) => b.pontuacao - a.pontuacao);
  }

  private filtrarElegiveis(
    candidatos: readonly Profissional[],
    contexto: ContextoRecomendacao,
  ): Profissional[] {
    const papelRequerido: Papel = contexto.papel.papel;
    const jaEscalados = new Set(contexto.idsEscalados());
    return candidatos.filter(
      (candidato) =>
        candidato.atuaComo(papelRequerido) &&
        candidato.estaDisponivelEm(contexto.projeto.periodoFiltragens) &&
        !jaEscalados.has(candidato.id),
    );
  }
}
