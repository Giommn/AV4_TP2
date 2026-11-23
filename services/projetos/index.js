import crypto from 'node:crypto';
import { iniciar, publicarEvento, lerCorpo } from '../shared.js';

await iniciar({
  nome: 'cinebridge-projetos', porta: Number(process.env.PORT || 3002), tabela: 'projetos',
  credenciais: { database: process.env.PROJETOS_DB || 'projetos' },
  consumir: async (canal, pool) => {
    await canal.assertQueue('criar-projetos', { durable: true });
    await canal.assertQueue('eventos-projetos', { durable: true });
    canal.prefetch(10);
    canal.consume('criar-projetos', async msg => {
      if (!msg) return;
      try {
        const evento = JSON.parse(msg.content.toString());
        await pool.query('INSERT INTO projetos(id,dados) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET dados=$2', [String(evento.id), evento]);
        await publicarEvento(canal, evento);
        if (msg.properties.replyTo) {
          canal.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify({ recebido: true, id: evento.id })), { correlationId: msg.properties.correlationId });
          await canal.waitForConfirms();
        }
        canal.ack(msg);
      } catch (erro) { console.error(erro); canal.nack(msg, false, true); }
    });
  },
  rotas: async ({ req, url, pool, canal, responder }) => {
    if (url.pathname === '/projetos' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT dados FROM projetos ORDER BY criado_em DESC');
      responder(200, rows.map(r => r.dados)); return true;
    }
    if ((url.pathname === '/projetos' || url.pathname.startsWith('/projetos/')) && ['POST','PUT','PATCH'].includes(req.method)) {
      const body = await lerCorpo(req);
      const id = url.pathname === '/projetos' ? String(body.id || crypto.randomUUID()) : decodeURIComponent(url.pathname.split('/')[2]);
      const evento = { ...body, id, tipo: body.status === 'finalizado' ? 'projeto.finalizado' : req.method === 'POST' ? 'projeto.criado' : 'projeto.atualizado', ocorridoEm: new Date().toISOString() };
      await pool.query('INSERT INTO projetos(id,dados) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET dados=$2', [id, evento]);
      await publicarEvento(canal, evento);
      responder(req.method === 'POST' ? 201 : 200, evento); return true;
    }
  },
});
