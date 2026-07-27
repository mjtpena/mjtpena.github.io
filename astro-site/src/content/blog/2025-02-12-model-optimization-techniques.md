---
title: "Model Optimization Techniques: From Training to Deployment"
author: Michael John Peña
draft: false
date: 2025-02-12
tags:
  - AI
  - Model Optimization
  - Deep Learning
  - MLOps
  - Performance

---

I wrote "Model Optimization Techniques: From Training to Deployment" to share practical, production-minded guidance on this topic.

## The Optimization Journey

```
Training          Post-Training          Deployment
    │                  │                     │
    ▼                  ▼                     ▼
┌─────────────┐  ┌──────────────┐    ┌─────────────────┐
│ Architecture│  │ Quantization │    │ Runtime Optim   │
│ Distillation│  │ Pruning      │    │ Hardware Accel  │
│ Efficient   │  │ Graph Optim  │    │ Serving Optim   │
│ Attention   │  │ Knowledge    │    │ Caching         │
└─────────────┘  │ Distillation │    └─────────────────┘
                 └──────────────┘
```

## Architecture Optimization

### Efficient Attention Mechanisms

```python
import torch
import torch.nn as nn
import math

class MultiQueryAttention(nn.Module):
    """Multi-Query Attention - Shared KV heads for efficiency."""

    def __init__(self, d_model: int, n_heads: int, n_kv_heads: int = 1):
        super().__init__()
        self.n_heads = n_heads
        self.n_kv_heads = n_kv_heads
        self.head_dim = d_model // n_heads

        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, n_kv_heads * self.head_dim)
        self.v_proj = nn.Linear(d_model, n_kv_heads * self.head_dim)
        self.o_proj = nn.Linear(d_model, d_model)

    def forward(self, x):
        batch, seq_len, _ = x.shape

        q = self.q_proj(x).view(batch, seq_len, self.n_heads, self.head_dim)
        k = self.k_proj(x).view(batch, seq_len, self.n_kv_heads, self.head_dim)
        v = self.v_proj(x).view(batch, seq_len, self.n_kv_heads, self.head_dim)

        # Expand KV to match query heads
        k = k.repeat_interleave(self.n_heads // self.n_kv_heads, dim=2)
        v = v.repeat_interleave(self.n_heads // self.n_kv_heads, dim=2)

        # Attention
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        attn = torch.softmax(scores, dim=-1)
        out = torch.matmul(attn, v)

        return self.o_proj(out.reshape(batch, seq_len, -1))


class FlashAttention(nn.Module):
    """Flash Attention - IO-aware attention computation."""

    def __init__(self, d_model: int, n_heads: int):
        super().__init__()
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model)
        self.out = nn.Linear(d_model, d_model)

    def forward(self, x):
        from flash_attn import flash_attn_func

        batch, seq_len, _ = x.shape

        qkv = self.qkv(x).reshape(batch, seq_len, 3, self.n_heads, self.head_dim)
        q, k, v = qkv.unbind(dim=2)

        # Flash attention - memory efficient
        out = flash_attn_func(q, k, v, causal=True)

        return self.out(out.reshape(batch, seq_len, -1))
```

### Model Pruning

```python
import torch.nn.utils.prune as prune

class ModelPruner:
    """Prune model weights for smaller, faster models."""

    def __init__(self, model):
        self.model = model

    def prune_unstructured(self, amount: float = 0.3):
        """Remove individual weights (unstructured pruning)."""
        for name, module in self.model.named_modules():
            if isinstance(module, (nn.Linear, nn.Conv2d)):
                prune.l1_unstructured(module, name='weight', amount=amount)

        return self._get_sparsity()

    def prune_structured(self, amount: float = 0.2):
        """Remove entire neurons/filters (structured pruning)."""
        for name, module in self.model.named_modules():
            if isinstance(module, nn.Linear):
                prune.ln_structured(module, name='weight', amount=amount, n=2, dim=0)

        return self._get_sparsity()

    def remove_pruning(self):
        """Make pruning permanent."""
        for name, module in self.model.named_modules():
            if isinstance(module, (nn.Linear, nn.Conv2d)):
                try:
                    prune.remove(module, 'weight')
                except:
                    pass

    def _get_sparsity(self) -> float:
        """Calculate model sparsity."""
        zeros = 0
        total = 0
        for param in self.model.parameters():
            zeros += (param == 0).sum().item()
            total += param.numel()
        return zeros / total

    def iterative_pruning(self, target_sparsity: float, steps: int = 5, fine_tune_fn=None):
        """Gradually prune and fine-tune."""
        current_sparsity = 0
        step_amount = target_sparsity / steps

        for step in range(steps):
            # Prune
            self.prune_unstructured(step_amount / (1 - current_sparsity))
            current_sparsity = self._get_sparsity()

            print(f"Step {step+1}: Sparsity = {current_sparsity:.2%}")

            # Fine-tune
            if fine_tune_fn:
                fine_tune_fn(self.model)

        self.remove_pruning()
        return current_sparsity
```

## Knowledge Distillation

```python
import torch.nn.functional as F

class DistillationTrainer:
    """Train smaller model to mimic larger model."""

    def __init__(
        self,
        teacher_model,
        student_model,
        temperature: float = 2.0,
        alpha: float = 0.5
    ):
        self.teacher = teacher_model
        self.student = student_model
        self.temperature = temperature
        self.alpha = alpha  # Balance between hard and soft labels

    def distillation_loss(self, student_logits, teacher_logits, labels):
        """Compute combined distillation loss."""

        # Soft targets (from teacher)
        soft_teacher = F.softmax(teacher_logits / self.temperature, dim=-1)
        soft_student = F.log_softmax(student_logits / self.temperature, dim=-1)
        soft_loss = F.kl_div(soft_student, soft_teacher, reduction='batchmean')
        soft_loss *= self.temperature ** 2

        # Hard targets (ground truth)
        hard_loss = F.cross_entropy(student_logits, labels)

        # Combined loss
        return self.alpha * soft_loss + (1 - self.alpha) * hard_loss

    def train_step(self, batch, optimizer):
        """Single training step."""
        inputs, labels = batch

        # Teacher inference (no grad)
        with torch.no_grad():
            teacher_logits = self.teacher(inputs)

        # Student inference
        student_logits = self.student(inputs)

        # Loss
        loss = self.distillation_loss(student_logits, teacher_logits, labels)

        # Update
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        return loss.item()

    def train(self, train_loader, optimizer, epochs: int = 10):
        """Full training loop."""
        self.teacher.eval()
        self.student.train()

        for epoch in range(epochs):
            total_loss = 0
            for batch in train_loader:
                loss = self.train_step(batch, optimizer)
                total_loss += loss

            print(f"Epoch {epoch+1}: Loss = {total_loss/len(train_loader):.4f}")

        return self.student
```

## Graph Optimization

```python
import onnx
from onnxruntime.transformers import optimizer

class GraphOptimizer:
    """Optimize ONNX computation graph."""

    def __init__(self, model_path: str):
        self.model_path = model_path

    def optimize(self, output_path: str):
        """Apply all graph optimizations."""

        # Load model
        model = onnx.load(self.model_path)

        # Basic optimizations
        from onnxruntime.transformers.onnx_model import OnnxModel
        onnx_model = OnnxModel(model)

        # Fuse operations
        self._fuse_operations(onnx_model)

        # Constant folding
        self._fold_constants(onnx_model)

        # Remove redundant operations
        self._remove_redundant(onnx_model)

        # Save optimized model
        onnx_model.save_model_to_file(output_path)

        return self._compare_models(self.model_path, output_path)

    def optimize_for_inference(self, output_path: str, model_type: str = "bert"):
        """Use ONNX Runtime's built-in optimizer."""

        optimized = optimizer.optimize_model(
            self.model_path,
            model_type=model_type,
            num_heads=12,  # Adjust based on model
            hidden_size=768,
            optimization_options=optimizer.FusionOptions(model_type),
            opt_level=99
        )

        optimized.save_model_to_file(output_path)

        return output_path

    def _fuse_operations(self, model):
        """Fuse consecutive operations."""
        # MatMul + Add -> GEMM
        # BatchNorm + ReLU -> FusedBatchNorm
        # etc.
        pass

    def _fold_constants(self, model):
        """Pre-compute constant expressions."""
        pass

    def _remove_redundant(self, model):
        """Remove identity operations and dead code."""
        pass
```

## Combining Techniques

```python
class OptimizationPipeline:
    """Apply multiple optimization techniques."""

    def __init__(self, model, calibration_data):
        self.model = model
        self.calibration_data = calibration_data

    def optimize(self, config: dict) -> dict:
        """Run optimization pipeline."""

        results = {"original": self._benchmark()}

        # 1. Pruning (if enabled)
        if config.get("pruning", {}).get("enabled", False):
            pruner = ModelPruner(self.model)
            sparsity = pruner.iterative_pruning(
                target_sparsity=config["pruning"]["target_sparsity"],
                steps=config["pruning"]["steps"]
            )
            results["after_pruning"] = self._benchmark()
            results["sparsity"] = sparsity

        # 2. Export to ONNX
        onnx_path = "model_optimized.onnx"
        self._export_to_onnx(onnx_path)

        # 3. Graph optimization
        if config.get("graph_optimization", True):
            opt = GraphOptimizer(onnx_path)
            opt.optimize(onnx_path)
            results["after_graph_opt"] = self._benchmark_onnx(onnx_path)

        # 4. Quantization
        if config.get("quantization", {}).get("enabled", False):
            quant = ModelQuantizer(onnx_path)
            quant_type = config["quantization"]["type"]

            if quant_type == "dynamic_int8":
                quant.quantize_dynamic_int8(onnx_path)
            elif quant_type == "static_int8":
                quant.quantize_static_int8(onnx_path, self.calibration_data)
            elif quant_type == "fp16":
                quant.quantize_float16(onnx_path)

            results["after_quantization"] = self._benchmark_onnx(onnx_path)

        # Report
        self._print_report(results)

        return results

    def _benchmark(self) -> dict:
        """Benchmark PyTorch model."""
        pass

    def _benchmark_onnx(self, path: str) -> dict:
        """Benchmark ONNX model."""
        pass

# Usage
config = {
    "pruning": {
        "enabled": True,
        "target_sparsity": 0.3,
        "steps": 5
    },
    "graph_optimization": True,
    "quantization": {
        "enabled": True,
        "type": "dynamic_int8"
    }
}

pipeline = OptimizationPipeline(model, calibration_data)
results = pipeline.optimize(config)
```

## Best Practices

1. **Benchmark baseline**: Know your starting point
2. **One technique at a time**: Isolate impact of each optimization
3. **Monitor quality**: Track accuracy throughout
4. **Test on target hardware**: Results vary by platform
5. **Profile memory**: Size matters for deployment
6. **Automate**: Build optimization into your pipeline

Model optimization is both science and art. Start with the techniques that offer the best impact for your specific constraints.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
