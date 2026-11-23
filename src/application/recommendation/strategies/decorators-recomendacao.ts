import { gzipSync } from 'node:zlib';
import { CandidatoRanqueado } from '../candidato-ranqueado.js';
import type { ContextoRecomendacao } from '../contexto-recomendacao.js';
import type { ParametrosRecomendacao } from '../parametros-recomendacao.js';
import type { RecomendacaoStrategy } from './recomendacao-strategy.js';
import type { Profissional } from '../../../domain/entities/profissional.js';

export type TipoDecoradorRecomendacao = 'cache' | 'auditoria' | 'compressao';

interface EntradaCache { readonly expiraEm: number; readonly resultado: CandidatoRanqueado[] }

export class CacheResultadosRecomendacao {
  readonly entradas = new Map<string, EntradaCache>();
  limpar(): void { this.entradas.clear(); }
}

export interface EventoAuditoriaRecomendacao {
  readonly projetoId: string;
  readonly papel: string;
  readonly inicio: string;
  readonly duracaoMs: number;
  readonly sucesso: boolean;
}

export interface MedicaoCompressao {
  readonly bytesOriginais: number;
  readonly bytesComprimidos: number;
  readonly payloadGzipBase64: string;
}

export interface MetricasDecoradores {
  readonly auditoria: EventoAuditoriaRecomendacao[];
  readonly compressao: MedicaoCompressao[];
}

export abstract class DecoradorEstrategia implements RecomendacaoStrategy {
  constructor(protected readonly interno: RecomendacaoStrategy) {}
  get nome(): RecomendacaoStrategy['nome'] { return this.interno.nome; }
  abstract recomendar(candidatos: readonly Profissional[], contexto: ContextoRecomendacao, parametros: ParametrosRecomendacao): CandidatoRanqueado[];
}

export class CacheDecorator extends DecoradorEstrategia {
  constructor(
    interno: RecomendacaoStrategy,
    private readonly ttlMs = 60_000,
    private readonly agora: () => number = Date.now,
    private readonly cache = new CacheResultadosRecomendacao(),
  ) { super(interno); }

  recomendar(candidatos: readonly Profissional[], contexto: ContextoRecomendacao, parametros: ParametrosRecomendacao): CandidatoRanqueado[] {
    const chave = this.chave(candidatos, contexto, parametros);
    const registro = this.cache.entradas.get(chave);
    if (registro && registro.expiraEm > this.agora()) return [...registro.resultado];
    this.cache.entradas.delete(chave);
    const resultado = this.interno.recomendar(candidatos, contexto, parametros);
    this.cache.entradas.set(chave, { expiraEm: this.agora() + this.ttlMs, resultado: [...resultado] });
    return resultado;
  }

  limpar(): void { this.cache.limpar(); }

  private chave(candidatos: readonly Profissional[], contexto: ContextoRecomendacao, parametros: ParametrosRecomendacao): string {
    return JSON.stringify({
      estrategia: this.interno.nome,
      tipoProjeto: contexto.projeto.tipoCaptacao,
      localizacaoProjeto: [contexto.projeto.localizacaoFiltragens.cidade, contexto.projeto.localizacaoFiltragens.uf, contexto.projeto.localizacaoFiltragens.pais],
      papel: contexto.papel.papel,
      pesoPapel: contexto.papel.peso,
      competenciasDesejadas: contexto.papel.competenciasDesejadas.paraObjeto(),
      periodo: [contexto.projeto.periodoFiltragens.inicio.toISOString(), contexto.projeto.periodoFiltragens.fim.toISOString()],
      disponivel: contexto.orcamentoDisponivel,
      escalados: contexto.membrosEscalados.map((p) => ({ id: p.id, afinidades: p.afinidades })),
      candidatos: candidatos.map((p) => ({ id: p.id, papeis: p.papeis, skills: p.competencias.paraObjeto(), precoMinimo: p.precoMinimo, precoMaximo: p.precoMaximo, avaliacao: p.mediaAvaliacoes, totalAvaliacoes: p.totalAvaliacoes, cidade: p.localizacao.cidade, uf: p.localizacao.uf, afinidades: p.afinidades })),
      parametros,
    });
  }
}

export class AuditoriaDecorator extends DecoradorEstrategia {
  readonly eventos: EventoAuditoriaRecomendacao[];
  constructor(interno: RecomendacaoStrategy, private readonly agora: () => number = Date.now, eventos?: EventoAuditoriaRecomendacao[]) {
    super(interno);
    this.eventos = eventos ?? [];
  }

  recomendar(candidatos: readonly Profissional[], contexto: ContextoRecomendacao, parametros: ParametrosRecomendacao): CandidatoRanqueado[] {
    const inicio = this.agora();
    try {
      const resultado = this.interno.recomendar(candidatos, contexto, parametros);
      this.eventos.push({ projetoId: contexto.projeto.id, papel: contexto.papel.papel, inicio: new Date(inicio).toISOString(), duracaoMs: this.agora() - inicio, sucesso: true });
      return resultado;
    } catch (erro) {
      this.eventos.push({ projetoId: contexto.projeto.id, papel: contexto.papel.papel, inicio: new Date(inicio).toISOString(), duracaoMs: this.agora() - inicio, sucesso: false });
      throw erro;
    }
  }
}

export class CompressaoDecorator extends DecoradorEstrategia {
  readonly medicoes: MedicaoCompressao[];
  constructor(interno: RecomendacaoStrategy, medicoes?: MedicaoCompressao[]) {
    super(interno);
    this.medicoes = medicoes ?? [];
  }

  recomendar(candidatos: readonly Profissional[], contexto: ContextoRecomendacao, parametros: ParametrosRecomendacao): CandidatoRanqueado[] {
    const resultado = this.interno.recomendar(candidatos, contexto, parametros);
    const bytes = Buffer.from(JSON.stringify(resultado.map((item) => ({ profissionalId: item.profissional.id, pontuacao: item.pontuacao, componentes: item.componentes }))));
    const gzip = gzipSync(bytes);
    this.medicoes.push({ bytesOriginais: bytes.byteLength, bytesComprimidos: gzip.byteLength, payloadGzipBase64: gzip.toString('base64') });
    // O contrato da estratégia segue retornando o mesmo resultado; o payload gzip fica pronto para transporte.
    return resultado;
  }
}

export function aplicarDecoradores(
  estrategia: RecomendacaoStrategy,
  tipos: readonly TipoDecoradorRecomendacao[],
  cacheResultados = new CacheResultadosRecomendacao(),
  metricas?: MetricasDecoradores,
): RecomendacaoStrategy {
  return tipos.reduce<RecomendacaoStrategy>((atual, tipo) => {
    if (tipo === 'cache') return new CacheDecorator(atual, 60_000, Date.now, cacheResultados);
    if (tipo === 'auditoria') return new AuditoriaDecorator(atual, Date.now, metricas?.auditoria);
    return new CompressaoDecorator(atual, metricas?.compressao);
  }, estrategia);
}
