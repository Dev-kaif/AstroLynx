# MOSDAC retrieval evaluation

`rag:evaluate-lexical` scores the local BM25 sidecar against human-reviewed source/page labels. It does not call a model, network service, embedding provider, or vector database. The evaluator reports hit rate, Recall@k, MRR, nDCG@k, and local search p50/p95 latency. See the result's `limitations` field before interpreting scores.

The repository includes a deliberately small [provisional seed set](./mosdac-seed-queries.provisional.md) to demonstrate the workflow and detect obvious retrieval misses. It was authored alongside source review, is not independently adjudicated, and must not be treated as a gold benchmark or used alone for tuning.

## Dataset format

Create a JSON array of answerable questions. Each item has a stable ID, the actual user query, and one or more source/page pairs known to contain useful evidence:

```json
[
  {
    "id": "sst-product-definition-001",
    "query": "How is sea surface temperature derived by INSAT-3D?",
    "relevant": [
      { "sourceId": "<64-character-sha256-from-reviewed-plan>", "pageNumber": 12 }
    ]
  }
]
```

Replace the example hash and page with values confirmed by reading the source. `sourceId` is the SHA-256 of the exact PDF; `pageNumber` is one-based. Omitting `pageNumber` labels any retrieved page from that document as relevant. Multiple entries represent alternative relevant pages/documents. Do not label a passage relevant solely because the extraction heuristic marked it usable. Keep unanswerable queries in a separate answer/abstention evaluation; this retrieval metric expects at least one relevant source/page per query.

## Run

```bash
pnpm rag:evaluate-lexical -- \
  --index /path/to/reviewed_mosdac_bm25.json \
  --dataset /path/to/mosdac_retrieval_labels.json \
  --k 5 \
  --repeats 10
```

The command prints JSON to stdout and has no output-file or index-write behavior. It performs one unmeasured search warm-up for each question, then repeats each measured search ten times by default (`--repeats` accepts 1–100). Per-question and aggregate latency percentiles use only measured sidecar searches; they exclude index loading, process startup, embedding, network, reranking, and generation. Run on a fixed labeled dataset after each retrieval/index change and retain the output with the corpus version. A single run on a tiny hand-selected set is diagnostic, not a general accuracy claim. Dense-only/hybrid comparisons, answer correctness, citation support, abstention calibration, and end-to-end latency still need their own evaluation.
