import http from 'node:http';
import amqp from 'amqplib';
import pg from 'pg';

export async function iniciar({ nome, porta, filaEventos, consumir, rotas = () => {}, tabela, credenciais }) {
  const pool = new pg.Pool({
    host: process.env.DB_HOST, port: 5432, database: credenciais.database,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  });
  const mqUrl = process.env.AMQP_URL;
  let conexao, canal;
  const ligarMq = async () => {
    conexao = await amqp.connect(mqUrl);
    canal = await conexao.createConfirmChannel();
    conexao.on('close', () => setTimeout(() => ligarMq().catch(console.error), 3000));
    await consumir?.(canal, pool);
  };
  await pool.query(`CREATE TABLE IF NOT EXISTS ${tabela} (id TEXT PRIMARY KEY, dados JSONB NOT NULL, criado_em TIMESTAMPTZ DEFAULT now())`);
  await ligarMq();
  const servidor = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const responder = (status, dados) => { res.statusCode = status; res.end(JSON.stringify(dados)); };
    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        await pool.query('SELECT 1');
        if (!canal) throw new Error('RabbitMQ indisponível');
        return responder(200, { status: 'ok', servico: nome });
      }
      if (filaEventos && req.method === 'POST' && url.pathname === '/eventos') {
        const corpo = await lerCorpo(req);
        canal.sendToQueue(filaEventos, Buffer.from(JSON.stringify(corpo)), { persistent: true });
        await canal.waitForConfirms();
        return responder(202, { publicado: true });
      }
      const resultado = await rotas({ req, res, url, pool, canal, responder, lerCorpo });
      if (!resultado) responder(404, { erro: 'Rota não encontrada' });
    } catch (erro) { responder(500, { erro: erro.message }); }
  });
  servidor.listen(porta, '0.0.0.0', () => console.log(`${nome} em :${porta}`));
  const fechar = async () => { servidor.close(); await canal?.close(); await conexao?.close(); await pool.end(); };
  process.on('SIGTERM', fechar);
  process.on('SIGINT', fechar);
}

export function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let texto = '';
    req.on('data', parte => { texto += parte; if (texto.length > 1_000_000) reject(new Error('Corpo muito grande')); });
    req.on('end', () => { try { resolve(texto ? JSON.parse(texto) : {}); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

export async function publicarEvento(canal, evento) {
  await canal.assertQueue('eventos-projetos', { durable: true });
  canal.sendToQueue('eventos-projetos', Buffer.from(JSON.stringify(evento)), { persistent: true });
  await canal.waitForConfirms();
}
