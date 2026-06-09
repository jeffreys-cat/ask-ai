# Ask AI 混合检索基线版本

当前 Ask AI 默认使用混合检索：向量检索 + Doris 全文关键词检索。外部 API 请求体保持不变。开启 query rewrite 后，系统会先把用户问题改写成更适合文档检索的 standalone query，再用于 embedding、关键词召回和 rerank；最终回答仍使用用户原始问题，避免回答偏离用户表达。

## 核心行为

- 向量分支使用 `INNER_PRODUCT(embedding, queryEmbedding)` 召回候选。
- 关键词分支使用 Doris tokenized inverted index、`MATCH_ANY` 和 `score()` BM25 分数召回候选。
- 每个分支候选数为 `min(max(topK * 4, 20), 50)`。
- 最终排序使用 RRF 融合，默认 `rrfK = 60`，以 `documentId + chunkId` 去重。
- 如果启用 rerank，RRF 会先返回更宽候选集，默认 `candidateK = min(max(topK * 8, 50), 100)`，再由 reranker 重新排序并截取最终 `topK`。
- `RetrievedChunk.score` 表示最终融合分数，不再表示单一路径的向量相似度。
- rerank 成功时 `RetrievedChunk.score` 表示 rerank relevance score；未启用或 fallback 时保持 RRF 分数。
- debug chunks 会带上可选 `retrieval` 字段，显示向量/BM25 原始分数、RRF fusion 分数、rerank 分数、rank 和命中路径。
- 检索支持可选元数据过滤：`version`、`language`、`productLine`、`publishedAt.from/to`。
- 文档可见性由服务端身份控制：缺失或 `public` 可见，`restricted` 必须匹配 chunk metadata 中的 `allowedUserIds` 或 `allowedApiKeyIds`。
- 可选 query rewrite：`QUERY_REWRITE_ENABLED=true` 时，检索前调用 chat model 改写请求；改写失败默认 fail-open 回退原问题。

外部 `/api/askai/search` 可传入过滤条件：

```json
{
  "query": "How do I configure authentication?",
  "topK": 3,
  "filters": {
    "version": ["3.0"],
    "language": "zh-CN",
    "productLine": "cloud",
    "publishedAt": { "from": "2026-01-01", "to": "2026-05-28" }
  }
}
```

## Doris 初始化

`pnpm doris:init` 会为 `document_chunks.content` 创建全文倒排索引：

```sql
CREATE INDEX IF NOT EXISTS idx_document_chunks_content
ON document_chunks (content)
USING INVERTED
PROPERTIES (
  "parser" = "unicode"
);
```

如果关键词分支因为 Doris 版本、索引或语法问题失败，运行时会记录 warning 并降级为向量结果，不中断问答。

## Rerank 配置

默认不配置 reranker 时，系统保持 `hybrid+rrf` 行为。配置 reranker 后，检索模式为 `hybrid+rrf+rerank`。

推荐使用 Qwen3 rerank 的 OpenAI-compatible 接口：

```bash
RERANK_PROVIDER=qwen
RERANK_API_KEY=...
RERANK_MODEL=qwen3-rerank
RERANK_BASE_URL=https://dashscope.aliyuncs.com
RERANK_CANDIDATE_K=50
RERANK_TIMEOUT_MS=3000
RERANK_MAX_DOC_CHARS=4000
RERANK_FAIL_OPEN=true
```

也支持 DashScope 原生 endpoint 和 Cohere：

```bash
RERANK_PROVIDER=dashscope
RERANK_PROVIDER=cohere
```

通用配置保持一致：`RERANK_API_KEY`、`RERANK_MODEL`、`RERANK_BASE_URL`、`RERANK_CANDIDATE_K`、`RERANK_TIMEOUT_MS`、`RERANK_MAX_DOC_CHARS`。`RERANK_PROVIDER=none` 可显式关闭 rerank。`RERANK_FAIL_OPEN=true` 时，rerank 请求失败、超时或未返回结果会回退到 RRF 顺序，不中断问答。

## Query Rewrite 配置

请求改写默认关闭。开启后复用 OpenAI-compatible chat endpoint，也可以单独指定改写模型：

```bash
QUERY_REWRITE_ENABLED=true
QUERY_REWRITE_MODEL=gpt-4.1-mini
QUERY_REWRITE_FAIL_OPEN=true
```

`QUERY_REWRITE_MODEL` 未配置时使用 `CHAT_MODEL`。`QUERY_REWRITE_FAIL_OPEN=true` 是默认行为，改写请求失败时继续使用原始问题完成检索和回答。

## 关键代码路径

- `packages/rag/src/retrieval/retrieve.ts`
- `packages/rag/src/retrieval/rerank.ts`
- `packages/doris/src/chunk-store.ts`
- `packages/ai/src/rewrite/request-rewriter.ts`
- `packages/ai/src/mastra/workflows/ask-docs.workflow.ts`
- `scripts/doris-init.ts`
- `packages/shared/src/types.ts`
