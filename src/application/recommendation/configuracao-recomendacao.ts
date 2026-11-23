import type { RecomendacaoStrategy } from './strategies/recomendacao-strategy.js';
import type { TipoDecoradorRecomendacao } from './strategies/decorators-recomendacao.js';
import { CacheResultadosRecomendacao, type MetricasDecoradores } from './strategies/decorators-recomendacao.js';

const TIPOS_VALIDOS: readonly TipoDecoradorRecomendacao[] = ['cache', 'auditoria', 'compressao'];

/** Preferências editáveis durante a execução e compartilhadas com cada novo motor de recomendação. */
export class ConfiguracaoRecomendacao {
  private estrategia?: RecomendacaoStrategy;
  private decoradores: TipoDecoradorRecomendacao[];
  readonly cacheResultados = new CacheResultadosRecomendacao();
  readonly metricas: MetricasDecoradores = { auditoria: [], compressao: [] };

  constructor(decoradores: readonly TipoDecoradorRecomendacao[] = []) {
    this.decoradores = this.validarDecoradores(decoradores);
  }

  obterEstrategia(): RecomendacaoStrategy | undefined { return this.estrategia; }
  obterDecoradores(): readonly TipoDecoradorRecomendacao[] { return [...this.decoradores]; }
  definirEstrategia(estrategia: RecomendacaoStrategy): void { this.estrategia = estrategia; }
  definirDecoradores(decoradores: readonly TipoDecoradorRecomendacao[]): void { this.decoradores = this.validarDecoradores(decoradores); }

  private validarDecoradores(decoradores: readonly TipoDecoradorRecomendacao[]): TipoDecoradorRecomendacao[] {
    for (const decorador of decoradores) {
      if (!TIPOS_VALIDOS.includes(decorador)) throw new Error(`Decorador de recomendação inválido: ${decorador}`);
    }
    return [...decoradores];
  }
}
