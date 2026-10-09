---
title: "Model Distillation: Creating Efficient Student Models"
author: Michael John Peña
draft: false
date: 2023-08-13
tags:
  - Model Distillation
  - Knowledge Distillation
  - Machine Learning
  - Optimization
---

## Distillation Overview

```python
distillation_concept = {
    "teacher": "Large, accurate model",
    "student": "Smaller, faster model",
    "knowledge": "Soft labels (probabilities) from teacher",
    "benefit": "Student learns richer information than hard labels"
}

# Why soft labels help:
# Hard label: [0, 0, 1] (just the class)
# Soft label: [0.1, 0.2, 0.7] (relationships between classes)
```

## Basic Distillation Implementation

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class DistillationLoss(nn.Module):
    def __init__(self, temperature=4.0, alpha=0.5):
        super().__init__()
        self.temperature = temperature
        self.alpha = alpha  # Weight for distillation loss

    def forward(self, student_logits, teacher_logits, labels):
        # Soft loss (distillation)
        soft_teacher = F.softmax(teacher_logits / self.temperature, dim=-1)
        soft_student = F.log_softmax(student_logits / self.temperature, dim=-1)
        distillation_loss = F.kl_div(
            soft_student,
            soft_teacher,
            reduction='batchmean'
        ) * (self.temperature ** 2)

        # Hard loss (standard cross-entropy)
        hard_loss = F.cross_entropy(student_logits, labels)

        # Combined loss
        return self.alpha * distillation_loss + (1 - self.alpha) * hard_loss

# Training loop
def train_distillation(teacher, student, train_loader, optimizer, epochs):
    teacher.eval()
    criterion = DistillationLoss(temperature=4.0, alpha=0.7)

    for epoch in range(epochs):
        student.train()
        total_loss = 0

        for batch in train_loader:
            inputs, labels = batch

            # Get teacher predictions
            with torch.no_grad():
                teacher_logits = teacher(inputs)

            # Get student predictions
            student_logits = student(inputs)

            # Compute distillation loss
            loss = criterion(student_logits, teacher_logits, labels)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        print(f"Epoch {epoch}: Loss = {total_loss / len(train_loader):.4f}")
```

## Distilling Transformers

```python
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments
)

# Teacher: Large model
teacher = AutoModelForSequenceClassification.from_pretrained("bert-large-uncased")

# Student: Smaller model
student = AutoModelForSequenceClassification.from_pretrained("distilbert-base-uncased")

# Custom trainer for distillation
class DistillationTrainer(Trainer):
    def __init__(self, teacher_model, temperature=4.0, alpha=0.5, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.teacher = teacher_model
        self.temperature = temperature
        self.alpha = alpha
        self.teacher.eval()

    def compute_loss(self, model, inputs, return_outputs=False):
        labels = inputs.pop("labels")

        # Student forward pass
        student_outputs = model(**inputs)
        student_logits = student_outputs.logits

        # Teacher forward pass
        with torch.no_grad():
            teacher_outputs = self.teacher(**inputs)
            teacher_logits = teacher_outputs.logits

        # Distillation loss
        loss = distillation_loss(
            student_logits, teacher_logits, labels,
            self.temperature, self.alpha
        )

        return (loss, student_outputs) if return_outputs else loss

# Train with distillation
trainer = DistillationTrainer(
    teacher_model=teacher,
    model=student,
    args=TrainingArguments(output_dir="./distilled"),
    train_dataset=train_dataset,
    temperature=4.0,
    alpha=0.5
)
trainer.train()
```

## Layer-wise Distillation

```python
class LayerDistillationLoss(nn.Module):
    """Distill intermediate layer representations."""

    def __init__(self, teacher_dim, student_dim):
        super().__init__()
        # Projection to match dimensions
        self.projector = nn.Linear(student_dim, teacher_dim)

    def forward(self, teacher_hidden, student_hidden):
        # Project student to teacher dimension
        student_projected = self.projector(student_hidden)

        # MSE loss on hidden states
        return F.mse_loss(student_projected, teacher_hidden)

# Training with layer distillation
def layer_distillation_step(teacher, student, inputs, layer_mapping):
    """
    layer_mapping: dict mapping student layers to teacher layers
    e.g., {0: 0, 1: 2, 2: 4, 3: 6} for 4-layer student from 6-layer teacher
    """
    # Get all hidden states
    with torch.no_grad():
        teacher_outputs = teacher(**inputs, output_hidden_states=True)
    student_outputs = student(**inputs, output_hidden_states=True)

    # Layer-wise loss
    layer_loss = 0
    for student_layer, teacher_layer in layer_mapping.items():
        layer_loss += F.mse_loss(
            student_outputs.hidden_states[student_layer],
            teacher_outputs.hidden_states[teacher_layer]
        )

    return layer_loss
```

## Attention Distillation

```python
def attention_distillation_loss(teacher_attentions, student_attentions, mapping):
    """Distill attention patterns from teacher to student."""
    loss = 0

    for student_layer, teacher_layer in mapping.items():
        teacher_attn = teacher_attentions[teacher_layer]  # [B, H, S, S]
        student_attn = student_attentions[student_layer]

        # If head counts differ, average teacher heads
        if teacher_attn.shape[1] != student_attn.shape[1]:
            teacher_attn = teacher_attn.mean(dim=1, keepdim=True)
            teacher_attn = teacher_attn.expand_as(student_attn)

        loss += F.mse_loss(student_attn, teacher_attn)

    return loss / len(mapping)
```

## TinyBERT-style Distillation

```python
class TinyBERTDistillation:
    """
    TinyBERT distills:
    1. Embedding layer
    2. Hidden states
    3. Attention matrices
    4. Prediction layer
    """

    def __init__(self, teacher, student, config):
        self.teacher = teacher
        self.student = student
        self.config = config

    def compute_loss(self, inputs, labels):
        # Forward passes with all outputs
        with torch.no_grad():
            teacher_out = self.teacher(
                **inputs,
                output_hidden_states=True,
                output_attentions=True
            )
        student_out = self.student(
            **inputs,
            output_hidden_states=True,
            output_attentions=True
        )

        # 1. Embedding loss
        emb_loss = F.mse_loss(
            student_out.hidden_states[0],
            teacher_out.hidden_states[0]
        )

        # 2. Hidden state loss
        hidden_loss = sum(
            F.mse_loss(s, t)
            for s, t in zip(
                student_out.hidden_states[1:],
                teacher_out.hidden_states[1::2]  # Every other layer
            )
        )

        # 3. Attention loss
        attn_loss = sum(
            F.mse_loss(s, t)
            for s, t in zip(
                student_out.attentions,
                teacher_out.attentions[::2]
            )
        )

        # 4. Prediction loss
        pred_loss = F.kl_div(
            F.log_softmax(student_out.logits / 4, dim=-1),
            F.softmax(teacher_out.logits / 4, dim=-1),
            reduction='batchmean'
        ) * 16

        return emb_loss + hidden_loss + attn_loss + pred_loss
```

## Distillation Best Practices

```python
best_practices = {
    "temperature": {
        "typical": "2-10, higher for softer distributions",
        "start": "4 is a good default"
    },
    "alpha": {
        "typical": "0.5-0.9",
        "more_distillation": "Higher alpha, more weight on teacher"
    },
    "architecture": {
        "student": "Same architecture family, fewer layers/dims",
        "ratio": "3-10x parameter reduction typical"
    },
    "training": {
        "epochs": "May need more than fine-tuning",
        "learning_rate": "Can use higher LR for student",
        "data": "Same or more data than teacher training"
    }
}
```

Tomorrow we'll dive deeper into knowledge distillation techniques.

## Resources

- [Distilling Knowledge in Neural Networks](https://arxiv.org/abs/1503.02531)
- [TinyBERT](https://arxiv.org/abs/1909.10351)
- [DistilBERT](https://arxiv.org/abs/1910.01108)
