---
title: "Knowledge Distillation: Advanced Techniques and Applications"
author: Michael John Peña
draft: false
date: 2023-08-14
tags:
  - Knowledge Distillation
  - Machine Learning
  - Model Compression
  - Deep Learning

---

I wrote "Knowledge Distillation: Advanced Techniques and Applications" to share practical, production-minded guidance on this topic.

## Advanced Distillation Strategies

```python
# Different types of knowledge to transfer
knowledge_types = {
    "response_based": "Output logits/probabilities",
    "feature_based": "Intermediate representations",
    "relation_based": "Relationships between samples/features"
}
```

## Self-Distillation

```python
class SelfDistillation(nn.Module):
    """Model distills knowledge from its deeper layers to shallower ones."""

    def __init__(self, base_model, num_classifiers=4):
        super().__init__()
        self.base_model = base_model
        self.hidden_size = base_model.config.hidden_size
        self.num_layers = base_model.config.num_hidden_layers

        # Add classifiers at intermediate layers
        self.classifiers = nn.ModuleList([
            nn.Linear(self.hidden_size, base_model.config.num_labels)
            for _ in range(num_classifiers)
        ])

        # Layers to attach classifiers
        self.classifier_layers = [
            self.num_layers // 4,
            self.num_layers // 2,
            3 * self.num_layers // 4,
            self.num_layers
        ]

    def forward(self, inputs, labels=None):
        outputs = self.base_model(**inputs, output_hidden_states=True)
        hidden_states = outputs.hidden_states

        # Get predictions from each classifier
        all_logits = []
        for i, (layer_idx, classifier) in enumerate(
            zip(self.classifier_layers, self.classifiers)
        ):
            logits = classifier(hidden_states[layer_idx])
            all_logits.append(logits)

        if labels is not None:
            # Self-distillation loss
            loss = self.compute_self_distillation_loss(all_logits, labels)
            return loss, all_logits[-1]

        return all_logits[-1]

    def compute_self_distillation_loss(self, all_logits, labels, temperature=3.0):
        # The deepest classifier is the "teacher"
        teacher_logits = all_logits[-1].detach()

        total_loss = 0
        for logits in all_logits:
            # Hard loss
            hard_loss = F.cross_entropy(logits, labels)

            # Soft loss (distill from deepest)
            if logits is not all_logits[-1]:
                soft_loss = F.kl_div(
                    F.log_softmax(logits / temperature, dim=-1),
                    F.softmax(teacher_logits / temperature, dim=-1),
                    reduction='batchmean'
                ) * (temperature ** 2)
                total_loss += hard_loss + soft_loss
            else:
                total_loss += hard_loss

        return total_loss / len(all_logits)
```

## Online Distillation

```python
class MutualLearning:
    """Two models learn from each other simultaneously."""

    def __init__(self, model1, model2, temperature=4.0):
        self.model1 = model1
        self.model2 = model2
        self.temperature = temperature

    def train_step(self, inputs, labels, optimizer1, optimizer2):
        # Forward pass for both models
        logits1 = self.model1(**inputs).logits
        logits2 = self.model2(**inputs).logits

        # Cross-entropy loss
        ce_loss1 = F.cross_entropy(logits1, labels)
        ce_loss2 = F.cross_entropy(logits2, labels)

        # Mutual distillation loss
        kl_loss1 = F.kl_div(
            F.log_softmax(logits1 / self.temperature, dim=-1),
            F.softmax(logits2.detach() / self.temperature, dim=-1),
            reduction='batchmean'
        )
        kl_loss2 = F.kl_div(
            F.log_softmax(logits2 / self.temperature, dim=-1),
            F.softmax(logits1.detach() / self.temperature, dim=-1),
            reduction='batchmean'
        )

        # Total losses
        loss1 = ce_loss1 + kl_loss1
        loss2 = ce_loss2 + kl_loss2

        # Update both models
        optimizer1.zero_grad()
        loss1.backward()
        optimizer1.step()

        optimizer2.zero_grad()
        loss2.backward()
        optimizer2.step()

        return loss1.item(), loss2.item()
```

## Feature Map Distillation

```python
class FeatureDistillation(nn.Module):
    """Distill intermediate feature maps with learned projections."""

    def __init__(self, teacher_dims, student_dims):
        super().__init__()
        # Projectors to align dimensions
        self.projectors = nn.ModuleList([
            nn.Sequential(
                nn.Linear(s_dim, t_dim),
                nn.ReLU(),
                nn.Linear(t_dim, t_dim)
            )
            for s_dim, t_dim in zip(student_dims, teacher_dims)
        ])

    def forward(self, teacher_features, student_features):
        """
        teacher_features: list of tensors from teacher layers
        student_features: list of tensors from student layers
        """
        loss = 0
        for projector, t_feat, s_feat in zip(
            self.projectors, teacher_features, student_features
        ):
            # Project student features
            s_projected = projector(s_feat)

            # Normalize and compute loss
            t_norm = F.normalize(t_feat, p=2, dim=-1)
            s_norm = F.normalize(s_projected, p=2, dim=-1)

            loss += F.mse_loss(s_norm, t_norm)

        return loss / len(self.projectors)
```

## Distillation for Generation Tasks

```python
class SequenceDistillation:
    """Distillation for autoregressive generation models."""

    def __init__(self, teacher, student, temperature=2.0):
        self.teacher = teacher
        self.student = student
        self.temperature = temperature

    def compute_loss(self, input_ids, attention_mask, labels):
        # Teacher forward (no gradient)
        with torch.no_grad():
            teacher_outputs = self.teacher(
                input_ids=input_ids,
                attention_mask=attention_mask
            )
            teacher_logits = teacher_outputs.logits

        # Student forward
        student_outputs = self.student(
            input_ids=input_ids,
            attention_mask=attention_mask
        )
        student_logits = student_outputs.logits

        # Shift for causal LM
        shift_logits = student_logits[..., :-1, :].contiguous()
        shift_teacher = teacher_logits[..., :-1, :].contiguous()
        shift_labels = labels[..., 1:].contiguous()

        # KL divergence loss per position
        kl_loss = F.kl_div(
            F.log_softmax(shift_logits / self.temperature, dim=-1),
            F.softmax(shift_teacher / self.temperature, dim=-1),
            reduction='none'
        ).sum(dim=-1)

        # Mask padding
        mask = (shift_labels != -100).float()
        kl_loss = (kl_loss * mask).sum() / mask.sum()

        # Hard loss
        ce_loss = F.cross_entropy(
            shift_logits.view(-1, shift_logits.size(-1)),
            shift_labels.view(-1),
            ignore_index=-100
        )

        return 0.5 * kl_loss * (self.temperature ** 2) + 0.5 * ce_loss
```

## Practical Distillation Pipeline

```python
def distill_model(
    teacher_model_name,
    student_model_name,
    train_dataset,
    eval_dataset,
    output_dir,
    temperature=4.0,
    alpha=0.7,
    epochs=5
):
    """Complete distillation pipeline."""

    # Load models
    teacher = AutoModelForSequenceClassification.from_pretrained(teacher_model_name)
    student = AutoModelForSequenceClassification.from_pretrained(student_model_name)
    tokenizer = AutoTokenizer.from_pretrained(student_model_name)

    teacher.eval()
    for param in teacher.parameters():
        param.requires_grad = False

    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=32,
        learning_rate=5e-5,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True
    )

    # Custom trainer
    trainer = DistillationTrainer(
        teacher_model=teacher,
        model=student,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        tokenizer=tokenizer,
        temperature=temperature,
        alpha=alpha
    )

    # Train
    trainer.train()

    # Evaluate
    results = trainer.evaluate()
    print(f"Final accuracy: {results['eval_accuracy']:.4f}")

    # Save
    student.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    return student, results
```

## When to Use Distillation

```python
distillation_use_cases = {
    "good_for": [
        "Deployment on edge devices",
        "Reducing inference latency",
        "When labeled data is limited",
        "Creating task-specific small models"
    ],
    "consider_alternatives": [
        "Quantization (simpler, often sufficient)",
        "Pruning (keeps architecture)",
        "Direct small model training (if data abundant)"
    ],
    "typical_compression": {
        "bert_large_to_distilbert": "60% size, ~97% accuracy",
        "gpt2_xl_to_gpt2": "75% size, ~95% quality"
    }
}
```

Tomorrow we'll explore small language models.

## Resources

- [Knowledge Distillation Survey](https://arxiv.org/abs/2006.05525)
- [DistilBERT Paper](https://arxiv.org/abs/1910.01108)
- [Self-Distillation](https://arxiv.org/abs/1905.08094)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
