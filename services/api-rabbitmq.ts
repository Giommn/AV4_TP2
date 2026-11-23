import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

let conexao: Awaited<ReturnType<typeof amqp.connect>> | undefined;
let canal: Awaited<ReturnType<Awaited<ReturnType<typeof amqp.connect>>['createConfirmChannel']>> | undefined;

export async function conectarRabbitMQ(): Promise<void> {
  if (canal) return;
  conexao = await amqp.connect(process.env.AMQP_URL ?? 'amqp://guest:guest@cinebridge-mq:5672');
  canal = await conexao.createConfirmChannel();
  await canal.assertQueue('consulta-profissionais', { durable: true });
  conexao.on('close', () => { canal = undefined; conexao = undefined; });
}

export async function consultarProfissionais(): Promise<unknown[]> {
  await conectarRabbitMQ();
  if (!canal) throw new Error('RabbitMQ indisponível');
  const correlacao = randomUUID();
  const { queue } = await canal.assertQueue('', { exclusive: true, autoDelete: true });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout consultando profissionais via RabbitMQ')), 8000);
    canal!.consume(queue, msg => {
      if (!msg || msg.properties.correlationId !== correlacao) return;
      clearTimeout(timeout);
      try { resolve((JSON.parse(msg.content.toString()) as { profissionais: unknown[] }).profissionais); }
      catch (erro) { reject(erro); }
      void canal!.ack(msg);
    }, { noAck: false }).then(() => {
      canal!.sendToQueue('consulta-profissionais', Buffer.from(JSON.stringify({ id: correlacao })), { persistent: true, replyTo: queue, correlationId: correlacao });
      return canal!.waitForConfirms();
    }).catch(erro => { clearTimeout(timeout); reject(erro); });
  });
}

export async function registrarProjeto(projeto: Record<string, unknown>): Promise<void> {
  await conectarRabbitMQ();
  if (!canal) throw new Error('RabbitMQ indisponível');
  const correlacao = randomUUID();
  const { queue } = await canal.assertQueue('', { exclusive: true, autoDelete: true });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout registrando projeto')), 8000);
    canal!.consume(queue, msg => {
      if (!msg || msg.properties.correlationId !== correlacao) return;
      clearTimeout(timeout);
      void canal!.ack(msg);
      resolve();
    }).then(() => {
      canal!.sendToQueue('criar-projetos', Buffer.from(JSON.stringify({
        ...projeto, tipo: 'projeto.criado', ocorridoEm: new Date().toISOString(),
      })), { persistent: true, replyTo: queue, correlationId: correlacao });
      return canal!.waitForConfirms();
    }).catch(erro => { clearTimeout(timeout); reject(erro); });
  });
}
