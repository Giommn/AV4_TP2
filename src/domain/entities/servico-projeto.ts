import { Papel } from '../enums/papel.js';

/** Componente comum da árvore de serviços de um projeto audiovisual. */
export interface ServicoProjeto {
  calcularCusto(): number;
  listarSubservicos(): readonly ServicoProjeto[];
  obterPrazo(): number;
  validar(): boolean;
}

export class ServicoAtomico implements ServicoProjeto {
  constructor(
    readonly nome: string,
    readonly papelTecnico: Papel,
    readonly custo: number,
    readonly prazoDias: number,
  ) {}

  calcularCusto(): number { return this.custo; }
  listarSubservicos(): readonly ServicoProjeto[] { return []; }
  obterPrazo(): number { return this.prazoDias; }
  validar(): boolean {
    return this.nome.trim().length > 0 && Object.values(Papel).includes(this.papelTecnico) &&
      Number.isFinite(this.custo) && this.custo >= 0 && Number.isFinite(this.prazoDias) && this.prazoDias > 0;
  }
}

/** Pacote executado em paralelo: o prazo é o caminho crítico (maior prazo dos filhos). */
export class PacoteServico implements ServicoProjeto {
  private readonly filhos: ServicoProjeto[] = [];

  constructor(readonly nome: string, servicos: readonly ServicoProjeto[] = [], readonly prazoLimiteDias?: number) {
    servicos.forEach((servico) => this.adicionar(servico));
  }

  adicionar(servico: ServicoProjeto): this {
    if (servico === this || this.contem(this, servico)) throw new Error('A árvore não pode conter ciclos');
    this.filhos.push(servico);
    return this;
  }

  remover(servico: ServicoProjeto): boolean {
    const indice = this.filhos.indexOf(servico);
    if (indice < 0) return false;
    this.filhos.splice(indice, 1);
    return true;
  }

  calcularCusto(): number { return this.filhos.reduce((total, servico) => total + servico.calcularCusto(), 0); }
  listarSubservicos(): readonly ServicoProjeto[] { return [...this.filhos]; }
  obterPrazo(): number { return this.filhos.reduce((maior, servico) => Math.max(maior, servico.obterPrazo()), 0); }
  validar(): boolean {
    return this.nome.trim().length > 0 && this.filhos.length > 0 && this.filhos.every((servico) => servico.validar()) &&
      (this.prazoLimiteDias === undefined || (this.prazoLimiteDias > 0 && this.obterPrazo() <= this.prazoLimiteDias));
  }

  private contem(alvo: ServicoProjeto, atual: ServicoProjeto): boolean {
    return atual === alvo || atual.listarSubservicos().some((filho) => this.contem(alvo, filho));
  }
}

export function clonarServico(servico: ServicoProjeto): ServicoProjeto {
  if (servico instanceof ServicoAtomico) return new ServicoAtomico(servico.nome, servico.papelTecnico, servico.custo, servico.prazoDias);
  if (servico instanceof PacoteServico) return new PacoteServico(servico.nome, servico.listarSubservicos().map(clonarServico), servico.prazoLimiteDias);
  throw new Error('Tipo de serviço não suportado para clonagem');
}

