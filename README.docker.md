# Docker 部署说明

本项目的 `docker-compose.yml` 只负责启动应用服务：

- `web`: Next.js standalone 运行镜像
- `worker`: 文档 ingest 后台 worker

Postgres 和 Doris 不在 compose 中启动，需要外部提供。

## 1. 准备环境变量

复制模板：

```bash
cp .env.docker.example .env.docker
```

编辑 `.env.docker`，至少确认这些变量：

```env
DATABASE_URL=postgres://postgres:postgres@your-postgres-host:5432/ask_ai
BETTER_AUTH_SECRET=change-me-to-a-long-random-string
BETTER_AUTH_URL=http://localhost:3000

DORIS_HOST=your-doris-host
DORIS_PORT=9030
DORIS_USER=root
DORIS_PASSWORD=
DORIS_DATABASE=ask_ai

OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-change-me
CHAT_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
```

如果 chat 和 embedding 使用不同供应商，可以只覆盖 chat：

```env
CHAT_BASE_URL=https://api.deepseek.com
CHAT_API_KEY=sk-change-me
CHAT_MODEL=deepseek-v4-flash
```

如果 Postgres 跑在宿主机上，容器里不要用 `localhost`，改用：

```env
DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/ask_ai
```

## 2. 外部数据库初始化

Postgres 迁移由外部处理。可以在宿主机执行：

```bash
pnpm db:migrate
```

Doris 建表也由外部处理。可以执行：

```bash
pnpm doris:init
```

执行前确保 `.env.local` 或当前 shell 环境里的 `DATABASE_URL`、`DORIS_*` 指向目标服务。

## 3. 构建镜像

默认基础镜像是 `node:24-alpine`：

```bash
docker compose build
```

也可以分别构建：

```bash
docker compose build web
docker compose build worker
```

如果需要使用内网镜像源或自定义 Node 镜像：

```bash
NODE_IMAGE=registry.example.com/library/node:24-alpine docker compose build
```

## 4. 启动服务

构建并后台启动：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f web
docker compose logs -f worker
```

调整 ingest 并发：

```env
INGEST_WORKER_CONCURRENCY=4
```

`INGEST_WORKER_CONCURRENCY` 控制单个 worker 容器内同时处理的 ingest job 数量，默认是 `1`。

也可以横向扩展 worker 容器：

```bash
docker compose up -d --scale worker=3
```

总 ingest 并发约等于 `worker 容器数 * INGEST_WORKER_CONCURRENCY`。worker 会通过 Postgres 行锁领取任务，多个容器或同一容器内多个并发 slot 不会领取同一条未过期任务。

停止服务：

```bash
docker compose down
```

## 5. 镜像产物

构建完成后会生成：

```text
ask-ai-web:latest
ask-ai-worker:latest
```

查看镜像大小：

```bash
docker image ls | grep ask-ai
```

## 6. 数据卷

compose 只创建一个卷：

```text
ingest-sources
```

它用于在 `web` 和 `worker` 之间共享本地 ingest 源文件。
