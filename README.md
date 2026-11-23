# Cinebridge — AV4

Sistema do Cinebridge preparado para execução em containers. O serviço de recomendação da AV3 foi mantido e integrado a três serviços HTTP, RabbitMQ e quatro bancos PostgreSQL separados.

## Arquitetura

| Container | Função | Porta |
|---|---|---:|
| `cinebridge-api` | API REST e recomendação | 3000 |
| `cinebridge-profissionais` | Cadastro e consulta de profissionais; consumidor RPC | 3001 |
| `cinebridge-projetos` | Cadastro e ciclo de vida de projetos | 3002 |
| `cinebridge-notificacoes` | Consome eventos de projetos e persiste notificações | 3003 |
| `cinebridge-mq` | RabbitMQ AMQP e painel de gerenciamento | 5672 / 15672 |
| `recomendacoes-db` | Persistência de recomendações | 5434 |
| `profissionais-db` | Persistência de profissionais | 5432 |
| `projetos-db` | Persistência de projetos | 5433 |
| `notificacoes-db` | Persistência de notificações | 5435 |

Os bancos ficam isolados em containers próprios dentro da rede bridge `cinebridge-net` e publicam as portas do diagrama (5432–5435) para desenvolvimento; em produção, remova essas publicações. Os serviços alcançam dependências pelos nomes de serviço. Os dados sobrevivem à recriação dos containers por volumes nomeados.

O endpoint de recomendação solicita a lista de profissionais via RPC AMQP na fila durável `consulta-profissionais`, com `replyTo` temporário e `correlationId`; o consumidor responde com confirmação de entrega. Após recomendar, a API envia o projeto pela fila durável `criar-projetos`; o serviço de projetos persiste o registro e publica o evento em `eventos-projetos` antes de confirmar a solicitação. Notificações consome os eventos, grava no próprio banco e confirma a mensagem. A fila de consulta usa `prefetch` e mensagens persistentes. A API persiste o resultado de recomendação em `recomendacoes-db`.

## Requisitos e inicialização

Docker Engine com Docker Compose v2 (Windows 10+ com Docker Desktop, Ubuntu 24.04+ ou derivados) e Node.js 18+ para execução local. A imagem base de todas as aplicações é `node:18-alpine`.

```sh
# Linux / macOS
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
# Edite POSTGRES_PASSWORD e RABBITMQ_PASSWORD antes de subir o ambiente.
docker compose up -d --build
docker compose ps
docker compose logs -f
```

O Compose aguarda os healthchecks dos bancos, do RabbitMQ e dos serviços dependentes. Para encerrar sem apagar os dados: `docker compose down`. Para apagar também os dados persistidos: `docker compose down -v`.

## Teste rápido

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/recomendacoes/equipe \
  -H 'Content-Type: application/json' \
  -d '{"tipoCaptacao":"ANIMACAO","orcamentoTotal":400000}'

curl -X POST http://localhost:3002/projetos \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Curta Cinebridge","status":"em andamento"}'

curl http://localhost:3003/notificacoes
```

Outros endpoints: `GET /prototipos`, `POST /convites/:conviteId/resposta`, `GET|POST /profissionais`, `GET /projetos`, `PUT /projetos/:id` e `GET /notificacoes`. Todos os serviços expõem `GET /health`, incluindo verificação de PostgreSQL e RabbitMQ. O painel RabbitMQ está em http://localhost:15672; use usuário e senha definidos em `RABBITMQ_USER` e `RABBITMQ_PASSWORD` (padrão local: cinebridge/cinebridge_dev).

## Desenvolvimento local

```sh
npm install
npm run dev
npm run build
npm test
```

Para executar localmente, defina `AMQP_URL`, `DB_HOST`, `POSTGRES_USER` e `POSTGRES_PASSWORD` conforme um ambiente PostgreSQL/RabbitMQ acessível. Para o fluxo completo, use Docker Compose.
