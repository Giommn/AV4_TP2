import type { EntradaProjeto, ServicoRecomendacao } from './servico-recomendacao.js';
import type { ResultadoComposicao } from '../orchestration/orquestrador-composicao-equipe.js';
import type { Projeto } from '../../domain/entities/projeto.js';
import type { ConfiguracaoRecomendacao } from '../recommendation/configuracao-recomendacao.js';
import type { RecomendacaoStrategy } from '../recommendation/strategies/recomendacao-strategy.js';
import type { TipoDecoradorRecomendacao } from '../recommendation/strategies/decorators-recomendacao.js';
import type { AdaptadorArmazenamento, AdaptadorPagamento, AdaptadorProfissional, MetadadosArquivo } from '../../infrastructure/adapters/adaptadores-externos.js';

/** Fachada da integração: injeta provedores externos e mantém o núcleo da orquestração independente deles. */
export class SistemaRecomendacao {
  constructor(
    private readonly servico: ServicoRecomendacao,
    private armazenamento: AdaptadorArmazenamento,
    private pagamento: AdaptadorPagamento,
    private profissional: AdaptadorProfissional,
    private readonly configuracao: ConfiguracaoRecomendacao,
  ) {
    this.servico.configurarAdaptadorProfissional(this.profissional);
  }

  configurarAdaptadores(adaptadores: { armazenamento?: AdaptadorArmazenamento; pagamento?: AdaptadorPagamento; profissional?: AdaptadorProfissional }): void {
    if (adaptadores.armazenamento) this.armazenamento = adaptadores.armazenamento;
    if (adaptadores.pagamento) this.pagamento = adaptadores.pagamento;
    if (adaptadores.profissional) {
      this.profissional = adaptadores.profissional;
      this.servico.configurarAdaptadorProfissional(this.profissional);
    }
  }

  definirEstrategia(estrategia: RecomendacaoStrategy): void { this.configuracao.definirEstrategia(estrategia); }
  configurarDecoradores(decoradores: readonly TipoDecoradorRecomendacao[]): void { this.configuracao.definirDecoradores(decoradores); }
  executarRecomendacao(dados: EntradaProjeto): Promise<ResultadoComposicao> { return this.servico.executar(dados); }
  armazenarArquivo(conteudo: Buffer, metadados?: MetadadosArquivo): Promise<string> { return this.armazenamento.salvarArquivo(conteudo, metadados); }
  recuperarArquivo(id: string): Promise<Buffer> { return this.armazenamento.recuperarArquivo(id); }
  pagarProjeto(projeto: Projeto): Promise<string> { return this.pagamento.efetuarPagamento(projeto.calcularCustoTotal(), 'cinebridge-produtor', projeto.id); }
  listarProfissionais(papel?: import('../../domain/enums/papel.js').Papel) { return this.profissional.listarProfissionais(papel ? { papel } : {}); }
}
