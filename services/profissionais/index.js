import { iniciar, lerCorpo } from '../shared.js';
import crypto from 'node:crypto';
import { gerarProfissionais } from '../../dist/src/infrastructure/persistence/gerador-profissionais.js';

const profissionaisDemo = gerarProfissionais().map(p => ({
  id: p.id, nome: p.nome, papeis: p.papeis, competencias: p.competencias.paraObjeto(),
  precoMinimo: p.precoMinimo, precoMaximo: p.precoMaximo,
  disponibilidade: p.disponibilidade.map(i => ({ inicio: i.inicio.toISOString(), fim: i.fim.toISOString() })),
  localizacao: { cidade: p.localizacao.cidade, uf: p.localizacao.uf, pais: p.localizacao.pais },
  mediaAvaliacoes: p.mediaAvaliacoes, totalAvaliacoes: p.totalAvaliacoes, afinidades: p.afinidades,
}));

await iniciar({
  nome: 'cinebridge-profissionais', porta: Number(process.env.PORT || 3001), tabela: 'profissionais',
  credenciais: { database: process.env.PROFISSIONAIS_DB || 'profissionais' },
  consumir: async (canal, pool) => {
    await canal.assertQueue('consulta-profissionais', { durable: true });
    canal.prefetch(10);
    canal.consume('consulta-profissionais', async msg => {
      if (!msg) return;
      try {
        const consulta = JSON.parse(msg.content.toString());
        const { rows } = await pool.query('SELECT dados FROM profissionais ORDER BY criado_em');
        const profissionais = rows.length ? rows.map(r => r.dados) : profissionaisDemo;
        canal.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify({ id: consulta.id, profissionais })), { persistent: true, correlationId: msg.properties.correlationId });
        canal.ack(msg);
      } catch (e) { console.error(e); canal.nack(msg, false, true); }
    });
  },
  rotas: async ({ req, url, pool, responder }) => {
    if (url.pathname === '/profissionais' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT dados FROM profissionais ORDER BY criado_em');
      responder(200, rows.map(r => r.dados)); return true;
    }
    if (url.pathname === '/profissionais' && req.method === 'POST') {
      const dados = await lerCorpo(req); const id = String(dados.id || crypto.randomUUID());
      await pool.query('INSERT INTO profissionais(id,dados) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET dados=$2', [id, { ...dados, id }]);
      responder(201, { ...dados, id }); return true;
    }
  },
});
