---
title: "Product Quantization for Extreme-Scale Vector Search"
author: Michael John Peña
draft: false
date: 2024-07-29
tags:
  - Azure
  - Vector Search
  - Product Quantization
  - Scale
  - Machine Learning

---

I wrote "Product Quantization for Extreme-Scale Vector Search" to share practical, production-minded guidance on this topic.

## Product Quantization Explained

PQ divides each vector into subvectors and quantizes each independently:

```
Original vector (1536 dims):
[v1, v2, v3, ..., v1536]

Split into 8 subvectors (192 dims each):
[v1...v192] [v193...v384] ... [v1345...v1536]

Each subvector quantized to cluster ID (0-255):
[45] [127] [89] [201] [33] [156] [78] [242]

Result: 8 bytes instead of 6144 bytes (768x compression)
```

## Full Implementation

```python
import numpy as np
from sklearn.cluster import MiniBatchKMeans
from typing import Optional
import pickle

class ProductQuantizer:
    def __init__(
        self,
        n_subvectors: int = 8,
        n_clusters: int = 256,
        dimension: int = 1536
    ):
        self.n_subvectors = n_subvectors
        self.n_clusters = n_clusters
        self.dimension = dimension
        self.subvector_dim = dimension // n_subvectors
        self.codebooks: list[MiniBatchKMeans] = []
        self.is_trained = False

    def train(self, vectors: np.ndarray, sample_size: int = 100000):
        """Train codebooks on vector corpus."""
        if len(vectors) > sample_size:
            indices = np.random.choice(len(vectors), sample_size, replace=False)
            training_data = vectors[indices]
        else:
            training_data = vectors

        self.codebooks = []

        for i in range(self.n_subvectors):
            start = i * self.subvector_dim
            end = start + self.subvector_dim
            subvectors = training_data[:, start:end]

            kmeans = MiniBatchKMeans(
                n_clusters=self.n_clusters,
                n_init=3,
                batch_size=1024,
                max_iter=100
            )
            kmeans.fit(subvectors)
            self.codebooks.append(kmeans)

            print(f"Trained codebook {i+1}/{self.n_subvectors}")

        self.is_trained = True

    def encode(self, vector: np.ndarray) -> np.ndarray:
        """Encode a single vector to PQ codes."""
        if not self.is_trained:
            raise ValueError("Quantizer not trained")

        codes = np.zeros(self.n_subvectors, dtype=np.uint8)

        for i, codebook in enumerate(self.codebooks):
            start = i * self.subvector_dim
            end = start + self.subvector_dim
            subvector = vector[start:end].reshape(1, -1)
            codes[i] = codebook.predict(subvector)[0]

        return codes

    def encode_batch(self, vectors: np.ndarray) -> np.ndarray:
        """Encode multiple vectors efficiently."""
        n_vectors = len(vectors)
        codes = np.zeros((n_vectors, self.n_subvectors), dtype=np.uint8)

        for i, codebook in enumerate(self.codebooks):
            start = i * self.subvector_dim
            end = start + self.subvector_dim
            subvectors = vectors[:, start:end]
            codes[:, i] = codebook.predict(subvectors)

        return codes

    def decode(self, codes: np.ndarray) -> np.ndarray:
        """Decode PQ codes back to approximate vector."""
        reconstructed = np.zeros(self.dimension)

        for i, code in enumerate(codes):
            start = i * self.subvector_dim
            end = start + self.subvector_dim
            reconstructed[start:end] = self.codebooks[i].cluster_centers_[code]

        return reconstructed

    def compute_asymmetric_distances(
        self,
        query: np.ndarray,
        codes_batch: np.ndarray
    ) -> np.ndarray:
        """
        Compute distances from query to encoded vectors.
        Uses asymmetric distance computation (ADC) for accuracy.
        """
        # Precompute distance lookup tables
        distance_tables = np.zeros((self.n_subvectors, self.n_clusters))

        for i, codebook in enumerate(self.codebooks):
            start = i * self.subvector_dim
            end = start + self.subvector_dim
            query_sub = query[start:end]

            # Distance from query subvector to all centroids
            for j, centroid in enumerate(codebook.cluster_centers_):
                distance_tables[i, j] = np.sum((query_sub - centroid) ** 2)

        # Compute distances using lookup tables
        n_vectors = len(codes_batch)
        distances = np.zeros(n_vectors)

        for idx in range(n_vectors):
            for i in range(self.n_subvectors):
                distances[idx] += distance_tables[i, codes_batch[idx, i]]

        return distances

    def search(
        self,
        query: np.ndarray,
        codes_database: np.ndarray,
        ids: np.ndarray,
        k: int = 10
    ) -> tuple[np.ndarray, np.ndarray]:
        """Search for k nearest neighbors."""
        distances = self.compute_asymmetric_distances(query, codes_database)
        top_k_indices = np.argpartition(distances, k)[:k]
        top_k_indices = top_k_indices[np.argsort(distances[top_k_indices])]

        return ids[top_k_indices], distances[top_k_indices]

    def save(self, path: str):
        """Save trained quantizer."""
        with open(path, 'wb') as f:
            pickle.dump({
                'n_subvectors': self.n_subvectors,
                'n_clusters': self.n_clusters,
                'dimension': self.dimension,
                'codebooks': self.codebooks
            }, f)

    @classmethod
    def load(cls, path: str) -> 'ProductQuantizer':
        """Load trained quantizer."""
        with open(path, 'rb') as f:
            data = pickle.load(f)

        pq = cls(
            n_subvectors=data['n_subvectors'],
            n_clusters=data['n_clusters'],
            dimension=data['dimension']
        )
        pq.codebooks = data['codebooks']
        pq.is_trained = True
        return pq
```

## PQ Index for Search

```python
class PQIndex:
    def __init__(self, pq: ProductQuantizer):
        self.pq = pq
        self.codes: Optional[np.ndarray] = None
        self.ids: Optional[np.ndarray] = None
        self.metadata: dict = {}

    def add(self, vectors: np.ndarray, ids: np.ndarray, metadata: dict = None):
        """Add vectors to the index."""
        codes = self.pq.encode_batch(vectors)

        if self.codes is None:
            self.codes = codes
            self.ids = ids
        else:
            self.codes = np.vstack([self.codes, codes])
            self.ids = np.concatenate([self.ids, ids])

        if metadata:
            for id_, meta in zip(ids, metadata):
                self.metadata[id_] = meta

    def search(self, query: np.ndarray, k: int = 10) -> list[dict]:
        """Search for similar vectors."""
        ids, distances = self.pq.search(query, self.codes, self.ids, k)

        results = []
        for id_, dist in zip(ids, distances):
            result = {
                "id": id_,
                "distance": float(dist),
                "score": 1 / (1 + float(dist))  # Convert to similarity
            }
            if id_ in self.metadata:
                result["metadata"] = self.metadata[id_]
            results.append(result)

        return results

    def save(self, path: str):
        """Save index to disk."""
        np.savez(
            path,
            codes=self.codes,
            ids=self.ids,
            metadata=self.metadata
        )

    def load(self, path: str):
        """Load index from disk."""
        data = np.load(path, allow_pickle=True)
        self.codes = data['codes']
        self.ids = data['ids']
        self.metadata = data['metadata'].item()

    @property
    def size_bytes(self) -> int:
        """Get index size in bytes."""
        return self.codes.nbytes if self.codes is not None else 0
```

## Inverted File Index with PQ (IVF-PQ)

For even faster search, combine with inverted file index:

```python
class IVFPQIndex:
    def __init__(
        self,
        pq: ProductQuantizer,
        n_lists: int = 1000,
        n_probe: int = 10
    ):
        self.pq = pq
        self.n_lists = n_lists
        self.n_probe = n_probe
        self.coarse_quantizer: Optional[MiniBatchKMeans] = None
        self.inverted_lists: dict[int, list] = {}

    def train(self, vectors: np.ndarray):
        """Train coarse quantizer."""
        self.coarse_quantizer = MiniBatchKMeans(
            n_clusters=self.n_lists,
            n_init=3,
            batch_size=1024
        )
        self.coarse_quantizer.fit(vectors[:min(100000, len(vectors))])

    def add(self, vectors: np.ndarray, ids: np.ndarray):
        """Add vectors to index."""
        # Assign to coarse clusters
        cluster_assignments = self.coarse_quantizer.predict(vectors)

        # Encode with PQ
        codes = self.pq.encode_batch(vectors)

        # Add to inverted lists
        for i, (cluster_id, code, vec_id) in enumerate(zip(cluster_assignments, codes, ids)):
            if cluster_id not in self.inverted_lists:
                self.inverted_lists[cluster_id] = []
            self.inverted_lists[cluster_id].append((vec_id, code))

    def search(self, query: np.ndarray, k: int = 10) -> list[tuple]:
        """Search with IVF-PQ."""
        # Find nearest coarse clusters
        centroids = self.coarse_quantizer.cluster_centers_
        coarse_distances = np.linalg.norm(centroids - query, axis=1)
        nearest_lists = np.argsort(coarse_distances)[:self.n_probe]

        # Collect candidates from selected lists
        candidates = []
        for list_id in nearest_lists:
            if list_id in self.inverted_lists:
                candidates.extend(self.inverted_lists[list_id])

        if not candidates:
            return []

        # Score candidates with PQ
        ids = np.array([c[0] for c in candidates])
        codes = np.array([c[1] for c in candidates])

        distances = self.pq.compute_asymmetric_distances(query, codes)

        # Return top-k
        top_k_idx = np.argpartition(distances, min(k, len(distances)-1))[:k]
        top_k_idx = top_k_idx[np.argsort(distances[top_k_idx])]

        return [(ids[i], distances[i]) for i in top_k_idx]
```

## Configuration Guidelines

| Dataset Size | n_subvectors | n_clusters | n_lists | Compression |
|-------------|--------------|------------|---------|-------------|
| < 1M | 8 | 256 | 100 | 768x |
| 1M - 10M | 16 | 256 | 1000 | 384x |
| 10M - 100M | 32 | 256 | 4000 | 192x |
| > 100M | 64 | 256 | 16000 | 96x |

## Recall vs Speed Trade-off

```python
def evaluate_pq_performance(
    index: IVFPQIndex,
    queries: np.ndarray,
    ground_truth: np.ndarray,
    k: int = 10
) -> dict:
    """Evaluate recall and speed at different n_probe values."""
    import time

    results = []

    for n_probe in [1, 2, 5, 10, 20, 50]:
        index.n_probe = n_probe

        recalls = []
        times = []

        for i, query in enumerate(queries):
            start = time.perf_counter()
            results_pq = index.search(query, k)
            elapsed = time.perf_counter() - start
            times.append(elapsed)

            retrieved_ids = set(r[0] for r in results_pq)
            true_ids = set(ground_truth[i][:k])
            recall = len(retrieved_ids & true_ids) / k
            recalls.append(recall)

        results.append({
            "n_probe": n_probe,
            "recall": np.mean(recalls),
            "qps": 1 / np.mean(times),
            "latency_ms": np.mean(times) * 1000
        })

    return results
```

## Integration with Azure

While Azure AI Search doesn't support PQ directly, you can use it as a first-stage filter:

```python
class HybridAzurePQSearch:
    def __init__(self, azure_client, pq_index: PQIndex):
        self.azure_client = azure_client
        self.pq_index = pq_index

    def search(self, query_embedding: list[float], k: int = 10) -> list[dict]:
        """Two-stage search: PQ filtering + Azure rescoring."""

        # Stage 1: Get candidates from PQ index
        query_arr = np.array(query_embedding)
        pq_results = self.pq_index.search(query_arr, k=k*10)
        candidate_ids = [r["id"] for r in pq_results]

        # Stage 2: Fetch and rescore from Azure
        if not candidate_ids:
            return []

        filter_expr = " or ".join(f"id eq '{id_}'" for id_ in candidate_ids[:100])

        azure_results = list(self.azure_client.search(
            search_text=None,
            vector_queries=[VectorizedQuery(
                vector=query_embedding,
                k_nearest_neighbors=k,
                fields="embedding"
            )],
            filter=filter_expr,
            top=k
        ))

        return azure_results
```

## Best Practices

1. **Train on representative data**: Codebook quality depends on training data
2. **Choose parameters based on scale**: More subvectors for larger datasets
3. **Use IVF for very large scales**: Reduces search space
4. **Monitor recall**: PQ has higher error than scalar quantization
5. **Consider two-stage**: PQ for filtering, exact for final ranking

## Conclusion

Product quantization enables vector search at scales that would otherwise be impractical. With compression ratios of 100-1000x, you can index billions of vectors on modest hardware.

Use PQ when scalar quantization isn't enough, and combine with inverted file indices for the fastest large-scale search.

