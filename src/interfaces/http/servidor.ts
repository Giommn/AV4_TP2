import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ErroNegocio, ErroNaoEncontrado } from '../../application/erros.js';
import { mapearHttpParaDadosProjeto, serializarConvite, serializarResultado } from './mappers.js';
import type { DependenciasAplicacao } from '../../composition/container.js';
import { gzipSync } from 'node:zlib';
import { Pool } from 'pg';
import { conectarRabbitMQ, consultarProfissionais, registrarProjeto } from '../../../services/api-rabbitmq.js';
import { Profissional } from '../../domain/entities/profissional.js';
import { VetorCompetencias } from '../../domain/value-objects/vetor-competencias.js';
import { Localizacao } from '../../domain/value-objects/localizacao.js';
import { IntervaloDatas } from '../../domain/value-objects/intervalo-datas.js';

const pool = new Pool({
  host: process.env.DB_HOST ?? 'cinebridge-recomendacoes-db',
  port: 5432, database: process.env.RECOMENDACOES_DB ?? 'recomendacoes',
  user: process.env.POSTGRES_USER ?? 'cinebridge', password: process.env.POSTGRES_PASSWORD ?? 'cinebridge_dev',
});

export function construirServidor(app: DependenciasAplicacao): FastifyInstance {
  const servidor = Fastify({ logger: false });
  const aceitaGzip = (valor: string | undefined): boolean => (valor ?? '').split(',').some((item) => {
    const [codificacao, ...parametros] = item.trim().split(';');
    const qualidade = parametros.find((parametro) => parametro.trim().startsWith('q='))?.trim().slice(2);
    return codificacao?.trim().toLowerCase() === 'gzip' && (qualidade === undefined || Number(qualidade) > 0);
  });

  servidor.get('/saude', async () => ({
    status: 'ok',
    servico: 'cinebridge-recomendacao',
  }));

  servidor.get('/health', async (_requisicao, resposta) => {
    try {
      await pool.query('SELECT 1');
      await conectarRabbitMQ();
      return { status: 'ok', servico: 'cinebridge-api' };
    } catch {
      return resposta.status(503).send({ status: 'indisponivel' });
    }
  });

  servidor.get('/prototipos', async () => app.registroPrototipos.listar());

  servidor.post('/recomendacoes/equipe', async (requisicao, resposta) => {
    const profissionais = await consultarProfissionais() as Array<{
      id: string;
      nome: string;
      papeis: string[];
      competencias: Record<string, number>;
      precoMinimo: number;
      precoMaximo: number;
      disponibilidade: Array<{ inicio: string; fim: string }>;
      localizacao: { cidade: string; uf: string; pais: string };
      mediaAvaliacoes: number;
      totalAvaliacoes: number;
      afinidades: Record<string, number>;
    }>;
    for (const profissional of profissionais) {
      await app.repositorioProfissionais.salvar(new Profissional({
        id: profissional.id,
        nome: profissional.nome,
        papeis: profissional.papeis as import('../../domain/enums/papel.js').Papel[],
        competencias: VetorCompetencias.criar(profissional.competencias ?? {}),
        precoMinimo: profissional.precoMinimo,
        precoMaximo: profissional.precoMaximo,
        localizacao: new Localizacao(profissional.localizacao.cidade, profissional.localizacao.uf, profissional.localizacao.pais),
        disponibilidade: profissional.disponibilidade.map((i: { inicio: string; fim: string }) => new IntervaloDatas(new Date(i.inicio), new Date(i.fim))),
        mediaAvaliacoes: profissional.mediaAvaliacoes,
        totalAvaliacoes: profissional.totalAvaliacoes,
        afinidades: profissional.afinidades,
      }));
    }
    const dados = mapearHttpParaDadosProjeto(requisicao.body);
    const resultado = await app.sistemaRecomendacao.executarRecomendacao(dados);
    const corpo = serializarResultado(resultado);
    await registrarProjeto(corpo.projeto as Record<string, unknown>);
    await pool.query('CREATE TABLE IF NOT EXISTS recomendacoes (id BIGSERIAL PRIMARY KEY, dados JSONB NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('INSERT INTO recomendacoes(dados) VALUES($1)', [corpo]);
    if (app.configuracaoRecomendacao.obterDecoradores().includes('compressao')) {
      resposta.header('vary', 'Accept-Encoding');
      if (aceitaGzip(requisicao.headers['accept-encoding'])) {
        return resposta
          .status(201)
          .header('content-type', 'application/json; charset=utf-8')
          .header('content-encoding', 'gzip')
          .send(gzipSync(JSON.stringify(corpo)));
      }
    }
    return resposta.status(201).send(corpo);
  });

  servidor.post('/convites/:conviteId/resposta', async (requisicao, resposta) => {
    const parametros = requisicao.params as { conviteId?: string };
    const conviteId = parametros.conviteId;
    if (!conviteId) {
      throw new ErroNegocio('Identificador do convite obrigatorio');
    }
    const corpo = requisicao.body as { aceito?: unknown } | undefined;
    if (!corpo || typeof corpo.aceito !== 'boolean') {
      throw new ErroNegocio('Campo aceito deve ser booleano');
    }
    const convite = await app.servicoConvite.responder(conviteId, corpo.aceito);
    return resposta.status(200).send(serializarConvite(convite));
  });

  servidor.setErrorHandler((erro, _requisicao, resposta) => {
    if (erro instanceof ErroNaoEncontrado) {
      return resposta.status(404).send({ erro: erro.message, codigo: erro.codigo });
    }
    if (erro instanceof ErroNegocio) {
      return resposta.status(422).send({ erro: erro.message, codigo: erro.codigo });
    }
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    return resposta.status(500).send({ erro: 'Erro interno', detalhe });
  });

  return servidor;
}
