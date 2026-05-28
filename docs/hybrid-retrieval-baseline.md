# Ask AI 混合检索基线版本

当前 Ask AI 默认使用混合检索：向量检索 + Doris 全文关键词检索。外部 API 请求体保持不变，检索层同时使用用户原始问题和 query embedding 召回候选 chunk。

## 核心行为

- 向量分支使用 `INNER_PRODUCT(embedding, queryEmbedding)` 召回候选。
- 关键词分支使用 Doris tokenized inverted index、`MATCH_ANY` 和 `score()` BM25 分数召回候选。
- 每个分支候选数为 `min(max(topK * 4, 20), 50)`。
- 最终排序使用 RRF 融合，默认 `rrfK = 60`，以 `documentId + chunkId` 去重。
- `RetrievedChunk.score` 表示最终融合分数，不再表示单一路径的向量相似度。
- debug chunks 会带上可选 `retrieval` 字段，显示向量/BM25 原始分数、rank 和命中路径。

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

## 关键代码路径

- `packages/rag/src/retrieval/retrieve.ts`
- `packages/doris/src/chunk-store.ts`
- `scripts/doris-init.ts`
- `packages/shared/src/types.ts`
