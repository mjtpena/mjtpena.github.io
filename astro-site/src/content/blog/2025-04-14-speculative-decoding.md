---
title: "Speculative Decoding: Accelerating LLM Generation"
author: Michael John Peña
draft: false
date: 2025-04-14
tags:
  - AI
  - LLM
  - Performance
  - Speculative Decoding
  - Optimization

---

I wrote "Speculative Decoding: Accelerating LLM Generation" to share practical, production-minded guidance on this topic.

## Speculative Decoding Implementation

```python
# speculative_decoding.py - Implement speculative decoding

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from typing import Tuple, List

class SpeculativeDecoder:
    """Accelerate LLM generation with speculative decoding."""

    def __init__(
        self,
        draft_model_name: str,
        target_model_name: str,
        num_speculative_tokens: int = 4
    ):
        self.num_speculative = num_speculative_tokens

        # Load draft model (small, fast)
        self.draft_model = AutoModelForCausalLM.from_pretrained(
            draft_model_name,
            torch_dtype=torch.float16,
            device_map="cuda:0"
        )

        # Load target model (large, accurate)
        self.target_model = AutoModelForCausalLM.from_pretrained(
            target_model_name,
            torch_dtype=torch.float16,
            device_map="cuda:0"
        )

        self.tokenizer = AutoTokenizer.from_pretrained(target_model_name)

    @torch.no_grad()
    def generate(self, prompt: str, max_tokens: int = 100) -> str:
        """Generate with speculative decoding."""
        input_ids = self.tokenizer.encode(prompt, return_tensors="pt").cuda()
        generated = input_ids.clone()

        while generated.shape[1] - input_ids.shape[1] < max_tokens:
            # Step 1: Draft tokens with small model
            draft_tokens, draft_probs = self.draft_tokens(generated)

            # Step 2: Verify with target model
            accepted, target_token = self.verify_tokens(
                generated, draft_tokens, draft_probs
            )

            # Step 3: Accept verified tokens
            generated = torch.cat([generated, accepted], dim=1)

            # Add one token from target model
            if target_token is not None:
                generated = torch.cat([generated, target_token], dim=1)

            # Check for EOS
            if self.tokenizer.eos_token_id in generated[0, -self.num_speculative:]:
                break

        return self.tokenizer.decode(generated[0], skip_special_tokens=True)

    def draft_tokens(self, context: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Generate draft tokens with small model."""
        draft_tokens = []
        draft_probs = []
        current = context.clone()

        for _ in range(self.num_speculative):
            outputs = self.draft_model(current)
            logits = outputs.logits[:, -1, :]
            probs = torch.softmax(logits, dim=-1)

            # Sample token
            token = torch.multinomial(probs, num_samples=1)
            draft_tokens.append(token)
            draft_probs.append(probs.gather(-1, token))

            current = torch.cat([current, token], dim=1)

        return torch.cat(draft_tokens, dim=1), torch.cat(draft_probs, dim=1)

    def verify_tokens(
        self,
        context: torch.Tensor,
        draft_tokens: torch.Tensor,
        draft_probs: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Verify draft tokens with target model."""
        # Run target model on full sequence
        full_sequence = torch.cat([context, draft_tokens], dim=1)
        outputs = self.target_model(full_sequence)
        target_logits = outputs.logits

        # Verify each draft token
        accepted_tokens = []
        for i in range(self.num_speculative):
            pos = context.shape[1] + i - 1
            target_probs = torch.softmax(target_logits[:, pos, :], dim=-1)

            draft_token = draft_tokens[:, i:i+1]
            target_prob = target_probs.gather(-1, draft_token)

            # Accept if target probability is high enough
            acceptance_ratio = target_prob / (draft_probs[:, i:i+1] + 1e-10)

            if torch.rand(1).cuda() < acceptance_ratio:
                accepted_tokens.append(draft_token)
            else:
                # Reject and sample from target
                target_token = torch.multinomial(target_probs, num_samples=1)
                return torch.cat(accepted_tokens, dim=1) if accepted_tokens else torch.tensor([]).cuda(), target_token

        # All accepted - sample one more from target
        last_logits = target_logits[:, -1, :]
        target_token = torch.multinomial(torch.softmax(last_logits, dim=-1), num_samples=1)

        return draft_tokens, target_token
```

Speculative decoding can achieve 2-3x speedup without any quality degradation.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
