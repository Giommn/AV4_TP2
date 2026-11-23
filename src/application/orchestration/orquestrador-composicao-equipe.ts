import { randomUUID } from 'node:crypto';
import { Equipe } from '../../domain/entities/equipe.js';
import { MembroEquipe } from '../../domain/entities/membro-equipe.js';
import { Recomendacao } from '../../domain/entities/recomendacao.js';
import { EquipeCompostaEvento, RecomendacaoGeradaEvento } from '../../domain/events/eventos.js';
import { ErroNegocio } from '../erros.js';
import { ContextoRecomendacao } from '../recommendation/contexto-recomendacao.js';
import type { MotorRecomendacao } from '../recommendation/motor-recomendacao.js';
import type { CandidatoRanqueado } from '../recommendation/candidato-ranqueado.js';
import { CalculadorCompatibilidadeEquipe, type MetricasCompatibilidade } from '../visitors/calculador-compatibilidade.js';
import { GeradorRelatorioProdutor, type RelatorioProdutor } from '../visitors/gerador-relatorio.js';
import type { FabricaProjeto } from '../factories/fabrica-projeto.js';
import type { ServicoConvite } from '../services/servico-convite.js';
import type { Violacao } from '../visitors/validadores-especializados.js';
import type { RelatorioEspecializado } from '../notifiers/notificador-projeto.js';
import type { Projeto } from '../../domain/entities/projeto.js';
import type { Convite } from '../../domain/entities/convite.js';
import type { Profissional } from '../../domain/entities/profissional.js';
import type { PapelRequerido } from '../../domain/entities/papel-requerido.js';
import type { Papel } from '../../domain/enums/papel.js';
import type {
  RepositorioConvites,
  RepositorioEquipes,
  RepositorioProfissionais,
  RepositorioProjetos,
  RepositorioRecomendacoes,
} from '../../domain/ports/repositorios.js';
import type { BarramentoEventos } from '../../domain/ports/barramento-eventos.js';
import type { ConfiguracaoRecomendacao } from '../recommendation/configuracao-recomendacao.js';
import type { AdaptadorProfissional } from '../../infrastructure/adapters/adaptadores-externos.js';
import { ServicoAtomico, type ServicoProjeto } from '../../domain/entities/servico-projeto.js';

export interface DependenciasOrquestrador {
  repositorioProfissionais: RepositorioProfissionais;
  repositorioProjetos: RepositorioProjetos;
  repositorioEquipes: RepositorioEquipes;
  repositorioConvites: RepositorioConvites;
  repositorioRecomendacoes: RepositorioRecomendacoes;
  servicoConvite: ServicoConvite;
  barramento: BarramentoEventos;
  provedorFallback: (papel: Papel) => Profissional[];
  configuracaoRecomendacao?: ConfiguracaoRecomendacao;
  adaptadorProfissional?: AdaptadorProfissional;
}

export interface ResultadoComposicao {
  readonly projeto: Projeto;
  readonly equipe: Equipe;
  readonly recomendacoes: readonly Recomendacao[];
  readonly convites: readonly Convite[];
  readonly violacoesProjeto: readonly Violacao[];
  readonly violacoesEquipe: readonly Violacao[];
  readonly metricas: MetricasCompatibilidade;
  readonly relatorioEspecializado: RelatorioEspecializado;
  readonly relatorioProdutor: RelatorioProdutor;
}

export class OrquestradorEquipe {
  constructor(
    private readonly fabrica: FabricaProjeto,
    private readonly deps: DependenciasOrquestrador,
  ) {}

  async compor(projeto: Projeto): Promise<ResultadoComposicao> {
    const profissionaisRepositorio = await this.deps.repositorioProfissionais.listar();
    const profissionaisExternos = await this.deps.adaptadorProfissional?.listarProfissionais() ?? [];
    const profissionaisDisponiveis = [...new Map(
      [...profissionaisRepositorio, ...profissionaisExternos].map((profissional) => [profissional.id, profissional]),
    ).values()];
    const mapaProfissionais = new Map<string, Profissional>(
      profissionaisDisponiveis.map((profissional) => [profissional.id, profissional]),
    );

    const validador = this.fabrica.criarValidador();
    const violacoesProjeto = validador.validarProjeto(projeto);
    this.garantirSemErros(violacoesProjeto);

    const projetoNormalizado = this.fabrica.normalizarProjeto(projeto);
    await this.deps.repositorioProjetos.salvar(projetoNormalizado);

    const motor = this.fabrica.criarRecomendador();
    const estrategiaConfigurada = this.deps.configuracaoRecomendacao?.obterEstrategia();
    if (estrategiaConfigurada) motor.definirEstrategia(estrategiaConfigurada);
    if (projetoNormalizado.estrategiaPreferida) {
      motor.trocarEstrategia(projetoNormalizado.estrategiaPreferida);
    }
    motor.configurarDecoradores(
      this.deps.configuracaoRecomendacao?.obterDecoradores() ?? [],
      this.deps.configuracaoRecomendacao?.cacheResultados,
      this.deps.configuracaoRecomendacao?.metricas,
    );
    const notificador = this.fabrica.criarNotificador();

    const equipe = new Equipe(randomUUID(), projetoNormalizado.id);
    const recomendacoes: Recomendacao[] = [];
    const membrosProfissionais: Profissional[] = [];
    const idsSelecionados = new Set<string>();

    const papelPorServico = (servico: ServicoAtomico): PapelRequerido => {
      const papel = projetoNormalizado.papeisObrigatorios.find((item) => item.papel === servico.papelTecnico);
      if (!papel) throw new ErroNegocio(`Papel ${servico.papelTecnico} não está vinculado ao projeto`);
      return papel;
    };
    const pesoDaArvore = (servico: ServicoProjeto): number => {
      if (servico instanceof ServicoAtomico) return papelPorServico(servico).peso;
      return servico.listarSubservicos().reduce((maior, filho) => Math.max(maior, pesoDaArvore(filho)), 0);
    };

    const recomendarServico = async (servico: ServicoProjeto): Promise<void> => {
      if (!(servico instanceof ServicoAtomico)) {
        const filhosOrdenados = [...servico.listarSubservicos()].sort((a, b) => pesoDaArvore(b) - pesoDaArvore(a));
        for (const filho of filhosOrdenados) await recomendarServico(filho);
        return;
      }
      const papel = papelPorServico(servico);
      const resultado = this.selecionarCandidato(
        papel,
        profissionaisDisponiveis,
        idsSelecionados,
        membrosProfissionais,
        projetoNormalizado,
        equipe,
        motor,
      );
      if (!resultado) {
        return;
      }
      const { escolhido, recomendados, origemDados } = resultado;

      const recomendacao = new Recomendacao({
        id: randomUUID(),
        projetoId: projetoNormalizado.id,
        papel: papel.papel,
        estrategiaUsada: motor.nomeEstrategia,
        origemDados,
        candidatos: recomendados.map((candidato) => candidato.paraRecomendado()),
      });
      recomendacoes.push(recomendacao);
      await this.deps.repositorioRecomendacoes.salvar(recomendacao);

      idsSelecionados.add(escolhido.profissional.id);
      membrosProfissionais.push(escolhido.profissional);
      mapaProfissionais.set(escolhido.profissional.id, escolhido.profissional);

      equipe.adicionarMembro(
        new MembroEquipe({
          profissionalId: escolhido.profissional.id,
          nomeProfissional: escolhido.profissional.nome,
          papel: papel.papel,
          cacheNegociado: escolhido.profissional.precoMinimo,
        }),
      );

      await notificador.notificar(
        new RecomendacaoGeradaEvento(
          projetoNormalizado.id,
          papel.papel,
          motor.nomeEstrategia,
          recomendados.length,
          escolhido.profissional.id,
          origemDados,
        ),
      );
    };
    await recomendarServico(projetoNormalizado.servicoPrincipal);

    await this.deps.repositorioEquipes.salvar(equipe);
    const violacoesEquipe = validador.validarEquipe(equipe, projetoNormalizado);

    await notificador.notificar(
      new EquipeCompostaEvento(
        equipe.id,
        projetoNormalizado.id,
        equipe.membros.length,
        equipe.custoTotal(),
      ),
    );

    const relatorioEspecializado = notificador.gerarRelatorio(
      projetoNormalizado,
      equipe,
      recomendacoes,
    );

    const convites = await this.deps.servicoConvite.gerarConvites(equipe, projetoNormalizado);

    const metricas = new CalculadorCompatibilidadeEquipe(mapaProfissionais).calcular(equipe);
    const relatorioProdutor = new GeradorRelatorioProdutor().gerar(
      projetoNormalizado,
      equipe,
      recomendacoes,
      metricas,
    );

    return {
      projeto: projetoNormalizado,
      equipe,
      recomendacoes,
      convites,
      violacoesProjeto,
      violacoesEquipe,
      metricas,
      relatorioEspecializado,
      relatorioProdutor,
    };
  }

  private selecionarCandidato(
    papel: PapelRequerido,
    profissionaisDisponiveis: readonly Profissional[],
    idsSelecionados: ReadonlySet<string>,
    membrosProfissionais: readonly Profissional[],
    projeto: Projeto,
    equipe: Equipe,
    motor: MotorRecomendacao,
  ):
    | {
        escolhido: CandidatoRanqueado;
        recomendados: CandidatoRanqueado[];
        origemDados: 'REPOSITORIO' | 'FALLBACK';
      }
    | undefined {
    const doRepositorio = profissionaisDisponiveis.filter(
      (profissional) => profissional.atuaComo(papel.papel) && !idsSelecionados.has(profissional.id),
    );
    const origemDados: 'REPOSITORIO' | 'FALLBACK' =
      doRepositorio.length > 0 ? 'REPOSITORIO' : 'FALLBACK';
    const base = doRepositorio.length > 0 ? doRepositorio : this.deps.provedorFallback(papel.papel);
    const contexto = new ContextoRecomendacao(
      projeto,
      papel,
      membrosProfissionais,
      Math.max(0, projeto.orcamentoTotal - equipe.custoTotal()),
    );
    const recomendados = motor.recomendar(base, contexto);
    const escolhido = recomendados[0];
    if (!escolhido) {
      return undefined;
    }
    return { escolhido, recomendados, origemDados };
  }

  private garantirSemErros(violacoes: readonly Violacao[]): void {
    const erros = violacoes.filter((violacao) => violacao.severidade === 'ERRO');
    if (erros.length > 0) {
      const mensagens = erros.map((erro) => `${erro.codigo}: ${erro.mensagem}`).join(' | ');
      throw new ErroNegocio(`Projeto invalido: ${mensagens}`, 'VALIDACAO_PROJETO');
    }
  }
}
