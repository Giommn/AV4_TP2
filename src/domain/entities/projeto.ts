import { PapelRequerido } from './papel-requerido.js';
import { Localizacao } from '../value-objects/localizacao.js';
import { IntervaloDatas } from '../value-objects/intervalo-datas.js';
import { TipoCaptacao } from '../enums/tipo-captacao.js';
import { Papel } from '../enums/papel.js';
import type { NomeEstrategia } from '../enums/nome-estrategia.js';
import type { EstiloAnimacao } from '../enums/estilo-animacao.js';
import type { VisitanteProjeto } from '../visitors/visitante-projeto.js';
import { clonarServico, PacoteServico, ServicoAtomico, type ServicoProjeto } from './servico-projeto.js';
import { VetorCompetencias } from '../value-objects/vetor-competencias.js';

export interface DadosProjeto {
  id: string;
  titulo?: string;
  genero: string;
  duracaoEstimadaMinutos: number;
  orcamentoTotal: number;
  dataEntrega: Date;
  tipoCaptacao: TipoCaptacao;
  localizacaoFiltragens: Localizacao;
  periodoFiltragens: IntervaloDatas;
  papeisObrigatorios: readonly PapelRequerido[];
  estrategiaPreferida?: NomeEstrategia;
  metaProducao: Record<string, unknown>;
  margemReservaImprevistos?: number;
  taxaQuadrosPorSegundo?: number;
  estiloAnimacao?: EstiloAnimacao;
  clienteAnunciante?: string;
  prazoVeiculacaoDias?: number;
  complexidadeCenografia?: number;
  servicoPrincipal?: ServicoProjeto;
}

export abstract class Projeto {
  readonly id: string;
  readonly titulo?: string;
  readonly genero: string;
  readonly duracaoEstimadaMinutos: number;
  readonly orcamentoTotal: number;
  readonly dataEntrega: Date;
  readonly tipoCaptacao: TipoCaptacao;
  readonly localizacaoFiltragens: Localizacao;
  readonly periodoFiltragens: IntervaloDatas;
  readonly papeisObrigatorios: readonly PapelRequerido[];
  readonly estrategiaPreferida?: NomeEstrategia;
  readonly metaProducao: Readonly<Record<string, unknown>>;
  readonly servicoPrincipal: ServicoProjeto;

  protected constructor(dados: DadosProjeto) {
    this.id = dados.id;
    this.titulo = dados.titulo;
    this.genero = dados.genero;
    this.duracaoEstimadaMinutos = dados.duracaoEstimadaMinutos;
    this.orcamentoTotal = dados.orcamentoTotal;
    this.dataEntrega = new Date(dados.dataEntrega.getTime());
    this.tipoCaptacao = dados.tipoCaptacao;
    this.localizacaoFiltragens = dados.localizacaoFiltragens.clonar();
    this.periodoFiltragens = dados.periodoFiltragens.clonar();
    this.estrategiaPreferida = dados.estrategiaPreferida;
    this.metaProducao = { ...dados.metaProducao };
    const papeisOriginais = dados.papeisObrigatorios.map((papel) => papel.clonar());
    this.servicoPrincipal = dados.servicoPrincipal
      ? clonarServico(dados.servicoPrincipal)
      : this.criarServicosPadrao(dados, papeisOriginais);
    this.papeisObrigatorios = dados.servicoPrincipal
      ? this.derivarPapeis(papeisOriginais, this.servicoPrincipal)
      : papeisOriginais;
  }

  abstract clonar(ajustes?: Partial<DadosProjeto>): Projeto;

  requerPapel(papel: Papel): boolean {
    return this.papeisObrigatorios.some((requerido) => requerido.papel === papel);
  }

  pesoDoPapel(papel: Papel): number {
    return this.papeisObrigatorios.find((requerido) => requerido.papel === papel)?.peso ?? 0;
  }

  pesoTotalPapeis(): number {
    return this.papeisObrigatorios.reduce((total, papel) => total + papel.peso, 0);
  }

  calcularCustoTotal(): number {
    return this.servicoPrincipal.calcularCusto();
  }

  validarServicos(): boolean {
    return this.servicoPrincipal.validar();
  }

  aceitarVisitante(visitante: VisitanteProjeto): void {
    visitante.visitarProjeto(this);
    for (const papel of this.papeisObrigatorios) {
      papel.aceitarVisitante(visitante);
    }
  }

  protected clonarBase(ajustes?: Partial<DadosProjeto>): DadosProjeto {
    const localizacao = ajustes?.localizacaoFiltragens ?? this.localizacaoFiltragens;
    const periodo = ajustes?.periodoFiltragens ?? this.periodoFiltragens;
    const papeis = ajustes?.papeisObrigatorios ?? this.papeisObrigatorios;
    return {
      id: ajustes?.id ?? this.id,
      titulo: ajustes?.titulo ?? this.titulo,
      genero: ajustes?.genero ?? this.genero,
      duracaoEstimadaMinutos: ajustes?.duracaoEstimadaMinutos ?? this.duracaoEstimadaMinutos,
      orcamentoTotal: ajustes?.orcamentoTotal ?? this.orcamentoTotal,
      dataEntrega: ajustes?.dataEntrega ? new Date(ajustes.dataEntrega.getTime()) : new Date(this.dataEntrega.getTime()),
      tipoCaptacao: this.tipoCaptacao,
      localizacaoFiltragens: localizacao.clonar(),
      periodoFiltragens: periodo.clonar(),
      papeisObrigatorios: papeis.map((papel) => papel.clonar()),
      estrategiaPreferida: ajustes?.estrategiaPreferida ?? this.estrategiaPreferida,
      metaProducao: { ...(ajustes?.metaProducao ?? this.metaProducao) },
      margemReservaImprevistos: ajustes?.margemReservaImprevistos,
      taxaQuadrosPorSegundo: ajustes?.taxaQuadrosPorSegundo,
      estiloAnimacao: ajustes?.estiloAnimacao,
      clienteAnunciante: ajustes?.clienteAnunciante,
      prazoVeiculacaoDias: ajustes?.prazoVeiculacaoDias,
      complexidadeCenografia: ajustes?.complexidadeCenografia,
      servicoPrincipal: clonarServico(ajustes?.servicoPrincipal ?? this.servicoPrincipal),
    };
  }

  private criarServicosPadrao(dados: DadosProjeto, papeis: readonly PapelRequerido[]): ServicoProjeto {
    const prazo = Math.max(1, this.periodoFiltragens.duracaoDias());
    if (papeis.length === 0) {
      return new PacoteServico(this.titulo ?? 'Serviços do projeto', [
        new ServicoAtomico('Produção audiovisual', Papel.DIRETOR, dados.orcamentoTotal, prazo),
      ]);
    }
    const pesoTotal = papeis.reduce((total, papel) => total + papel.peso, 0);
    let restante = dados.orcamentoTotal;
    const itens = papeis.map((papel, indice) => {
      const custo = indice === papeis.length - 1
        ? restante
        : pesoTotal > 0 ? dados.orcamentoTotal * papel.peso / pesoTotal : dados.orcamentoTotal / papeis.length;
      restante -= custo;
      return new ServicoAtomico(papel.papel, papel.papel, custo, prazo);
    });
    return new PacoteServico(this.titulo ?? 'Serviços do projeto', itens);
  }

  private derivarPapeis(originais: readonly PapelRequerido[], servico: ServicoProjeto): PapelRequerido[] {
    const atomicos: ServicoAtomico[] = [];
    const percorrer = (atual: ServicoProjeto): void => {
      if (atual instanceof ServicoAtomico) atomicos.push(atual);
      else atual.listarSubservicos().forEach(percorrer);
    };
    percorrer(servico);
    const papeisUnicos = [...new Set(atomicos.map((atomo) => atomo.papelTecnico))];
    return papeisUnicos.map((papel) => {
      const existente = originais.find((item) => item.papel === papel);
      return existente?.clonar() ?? new PapelRequerido(papel, 1, VetorCompetencias.vazio());
    });
  }
}
