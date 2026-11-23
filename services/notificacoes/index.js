import { iniciar } from '../shared.js';

await iniciar({
  nome: 'cinebridge-notificacoes', porta: Number(process.env.PORT || 3003), tabela: 'notificacoes',
  credenciais: { database: process.env.NOTIFICACOES_DB || 'notificacoes' },
  consumir: async (canal, pool) => {
    await canal.assertQueue('eventos-projetos', { durable: true });
    canal.prefetch(10);
    canal.consume('eventos-projetos', async msg => {
      if (!msg) return;
      try {
        const evento = JSON.parse(msg.content.toString());
        const id = `${evento.tipo || 'evento'}:${evento.id || Date.now()}:${Date.now()}`;
        const registro = { id, projetoId: evento.id, tipo: evento.tipo, mensagem: `Evento recebido: ${evento.tipo || 'projeto'}`, evento, criadoEm: new Date().toISOString() };
        await pool.query('INSERT INTO notificacoes(id,dados) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [id, registro]);
        console.log('Notificação persistida:', registro.mensagem, registro.projetoId);
        canal.ack(msg);
      } catch (e) { console.error(e); canal.nack(msg, false, true); }
    });
  },
  rotas: async ({ req, url, pool, responder }) => {
    if (url.pathname === '/notificacoes' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT dados FROM notificacoes ORDER BY criado_em DESC');
      responder(200, rows.map(r => r.dados)); return true;
    }
  },
});
