# P2-A local embedding candidate screening

Date: 2026-09-09

This screening uses publisher/model-owner metadata and runtime documentation. It authorizes development-only offline spikes, not production dependencies or model distribution.

## Runtime boundary

The spike runtime is `@huggingface/transformers` 4.2.0 with local ONNX assets. The project is Apache-2.0 and documents `env.allowRemoteModels = false`, `env.localModelPath`, and local WASM paths for offline execution. It uses ONNX Runtime. ONNX Runtime's Node binding documents CPU prebuilt support for Windows x64, Linux x64/arm64, and macOS x64/arm64, covering Kun's five packaging targets.

Primary sources:

- [Transformers.js repository and offline settings](https://github.com/huggingface/transformers.js)
- [Transformers.js local model configuration](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/docs/snippets/3_custom-usage.snippet)
- [ONNX Runtime Node requirements and CPU platform matrix](https://github.com/microsoft/onnxruntime/tree/main/js/node)

The runtime is not added to Kun's package manifests in P2-A. Candidate acquisition and execution use an isolated local evaluation directory so normal dependency and package surfaces remain unchanged.

## Candidate A: multilingual-e5-small

| Field | Frozen value |
|---|---|
| Original model | `intfloat/multilingual-e5-small` |
| Original revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| License | MIT |
| Languages | 100, including English and Chinese |
| Dimensions | 384 |
| Required input convention | `query: ` for queries and `passage: ` for Memory records |
| Pooling/normalization | attention-mask mean pooling, L2 normalization |
| ONNX conversion | `Xenova/multilingual-e5-small` |
| Conversion revision | `761b726dd34fb83930e26aab4e9ac3899aa1fa78` |
| q8 model loaded by Transformers.js 4.2 | `onnx/model_quantized.onnx`, 118,308,185 bytes |
| q8 SHA-256 | `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193` |
| Tokenizer JSON | 17,082,730 bytes |
| SentencePiece model | 5,069,051 bytes |
| Measured local model assets | 135,392,016 bytes |

The original model card explicitly describes multilingual retrieval, 384 dimensions, the query/passage prefixes, mean pooling, L2 normalization, and reduced quality risk for low-resource languages. The selected int8 model plus tokenizer assets remain under the provisional 200 MiB model-payload gate.

Primary sources:

- [Original multilingual-e5-small model card](https://huggingface.co/intfloat/multilingual-e5-small)
- [Transformers.js-compatible ONNX conversion](https://huggingface.co/Xenova/multilingual-e5-small)

Decision: **primary spike candidate**. Its retrieval training and explicit Chinese coverage match the benchmark, but the prefix convention must be frozen as part of candidate identity.

## Candidate B: paraphrase-multilingual-MiniLM-L12-v2

| Field | Frozen value |
|---|---|
| Original model | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` |
| Original revision | `e8f8c211226b894fcb81acc59f3b34ba3efd5f42` |
| License | Apache-2.0 |
| Languages | 50-language multilingual model; model metadata includes Chinese variants |
| Dimensions | 384 |
| Maximum sequence length | 128 |
| Pooling/normalization | mean pooling, L2 normalization for cosine comparison |
| ONNX conversion | `onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX` |
| Conversion revision | `d4c06bf0d7680171ac30042a1387e1fdb7a90021` |
| q8 model loaded by Transformers.js 4.2 | `onnx/model_quantized.onnx`, 118,049,319 bytes |
| q8 SHA-256 | `0029fce9c82365d8a2bf20e03a476e84785a872d8d423c8bac0fd0f350df88dc` |
| Tokenizer JSON | 17,082,987 bytes |
| Measured local model assets | 135,134,376 bytes |

The model card describes a 384-dimensional sentence-similarity space and Apache-2.0 license. Its int8 model and tokenizer remain under the provisional payload gate.

Primary sources:

- [Original multilingual MiniLM model card](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
- [Transformers.js-compatible ONNX conversion](https://huggingface.co/onnx-community/paraphrase-multilingual-MiniLM-L12-v2-ONNX)

Decision: **comparison spike candidate**. It provides a symmetric paraphrase baseline without E5 prefixes, but E5 remains the preferred first run because this change evaluates retrieval as well as paraphrase similarity.

## Rejected directions

- Hosted embedding APIs: rejected because Memory text would leave the local boundary and the offline fallback requirement could not be evaluated fairly.
- English-only small models: rejected because 13 of 40 frozen queries are Chinese and 12 cases are cross-lingual.
- Models or mandatory artifacts exceeding 200 MiB: rejected before quality evaluation.
- LLM reranking: rejected because it is less deterministic, adds network/model cost, and is outside P2-A.

## Development result and candidate selection

Both conversions were acquired into an untracked cache and then hard-linked into a local-model-only directory. Measured runs used `env.allowRemoteModels = false`, `local_files_only = true`, and the in-process network guard. The guard observed zero attempts. No model, runtime package, or generated index is included in the submitted diff.

On the 32-query development split, the selected E5 configuration uses a 0.80 cosine threshold followed by gated RRF: only records that pass the semantic threshold can participate, and lexical rank only reorders that set. With equal weights and rank constant 60 it achieved Recall@5 0.893, Precision@5 0.352, MRR 0.794, and abstention accuracy 1.0. The lexical baseline was 0.821, 0.293, 0.771, and 0 respectively. All hard safety counters remained zero.

MiniLM's best perfect-abstention configuration used threshold 0.45 and achieved Recall@5 0.786, Precision@5 0.576, and MRR 0.744. It was not selected because it regressed recall and MRR relative to both E5 and the lexical baseline. Detailed development evidence is stored in `semantic-memory-development-screening.v1.json`; it contains no holdout output.
