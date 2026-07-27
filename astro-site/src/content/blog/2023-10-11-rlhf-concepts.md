---
title: "RLHF Concepts: Reinforcement Learning from Human Feedback"
author: Michael John Peña
draft: false
date: 2023-10-11
description: "Understanding Reinforcement Learning from Human Feedback and its role in aligning LLMs with human preferences."
tags:
  - RLHF
  - Machine Learning
  - LLM Training
  - AI Alignment
  - AI

---

I wrote "RLHF Concepts: Reinforcement Learning from Human Feedback" to share practical, production-minded guidance on this topic.

## Introduction

Reinforcement Learning from Human Feedback (RLHF) is a technique used to fine-tune large language models to better align with human preferences. This post explains the core concepts and how RLHF shapes modern LLM behavior.

## RLHF Pipeline Overview

```python
from dataclasses import dataclass
from typing import List, Tuple
from enum import Enum

class RLHFStage(Enum):
    SFT = "supervised_finetuning"
    REWARD_MODEL = "reward_model_training"
    PPO = "ppo_optimization"

@dataclass
class RLHFPipeline:
    """Conceptual representation of RLHF pipeline"""
    base_model: str
    sft_data: List[dict]
    preference_data: List[dict]
    ppo_config: dict

    def describe_stages(self) -> dict:
        return {
            "stage_1_sft": {
                "name": "Supervised Fine-Tuning",
                "description": "Train model on high-quality demonstrations",
                "input": "Prompt-response pairs from experts",
                "output": "SFT model that follows instructions"
            },
            "stage_2_reward": {
                "name": "Reward Model Training",
                "description": "Train model to predict human preferences",
                "input": "Pairs of responses with preference labels",
                "output": "Reward model that scores responses"
            },
            "stage_3_ppo": {
                "name": "PPO Optimization",
                "description": "Optimize policy using reward signal",
                "input": "SFT model + Reward model",
                "output": "Final aligned model"
            }
        }
```

## Stage 1: Supervised Fine-Tuning (SFT)

```python
from typing import List, Dict

class SFTDataPreparation:
    """Prepare data for supervised fine-tuning"""

    @staticmethod
    def format_instruction_data(examples: List[Dict]) -> List[Dict]:
        """Format data for instruction tuning"""
        formatted = []
        for example in examples:
            formatted.append({
                "prompt": f"### Instruction:\n{example['instruction']}\n\n### Response:",
                "completion": f"\n{example['response']}"
            })
        return formatted

    @staticmethod
    def create_chat_format(conversations: List[List[Dict]]) -> List[Dict]:
        """Format multi-turn conversations"""
        formatted = []
        for conv in conversations:
            messages = []
            for turn in conv:
                messages.append({
                    "role": turn["role"],
                    "content": turn["content"]
                })
            formatted.append({"messages": messages})
        return formatted

# Example SFT data
sft_examples = [
    {
        "instruction": "Explain photosynthesis in simple terms",
        "response": "Photosynthesis is how plants make food. They use sunlight, water, and carbon dioxide to create sugar and oxygen."
    },
    {
        "instruction": "Write a haiku about coding",
        "response": "Lines of code unfold\nBugs emerge then disappear\nProgram comes alive"
    }
]

formatted_data = SFTDataPreparation.format_instruction_data(sft_examples)
```

## Stage 2: Reward Model Training

```python
@dataclass
class PreferencePair:
    """A preference comparison between two responses"""
    prompt: str
    chosen: str  # Preferred response
    rejected: str  # Non-preferred response
    metadata: Dict = None

class RewardModelDataset:
    """Dataset for reward model training"""

    def __init__(self):
        self.pairs: List[PreferencePair] = []

    def add_comparison(self, prompt: str, response_a: str, response_b: str, preference: str):
        """Add a preference comparison

        Args:
            preference: 'A' if response_a is better, 'B' if response_b is better
        """
        if preference == 'A':
            pair = PreferencePair(prompt=prompt, chosen=response_a, rejected=response_b)
        else:
            pair = PreferencePair(prompt=prompt, chosen=response_b, rejected=response_a)

        self.pairs.append(pair)

    def to_training_format(self) -> List[Dict]:
        """Convert to training format"""
        return [
            {
                "prompt": pair.prompt,
                "chosen": pair.chosen,
                "rejected": pair.rejected
            }
            for pair in self.pairs
        ]

    def compute_agreement_stats(self, annotations: List[List[str]]) -> Dict:
        """Compute inter-annotator agreement"""
        if len(annotations) < 2:
            return {"error": "Need at least 2 annotators"}

        agreements = 0
        total = len(annotations[0])

        for i in range(total):
            votes = [ann[i] for ann in annotations]
            if len(set(votes)) == 1:  # All agree
                agreements += 1

        return {
            "agreement_rate": agreements / total,
            "total_comparisons": total,
            "unanimous": agreements
        }

# Conceptual reward model
class ConceptualRewardModel:
    """Illustrates how reward model works"""

    def __init__(self):
        # In practice, this would be a trained neural network
        self.preference_patterns = {
            "helpful": 1.0,
            "harmless": 0.8,
            "honest": 0.9,
            "detailed": 0.5,
            "concise": 0.3
        }

    def score(self, prompt: str, response: str) -> float:
        """Score a response (simplified)"""
        score = 0.5  # Base score

        # Check for positive patterns
        response_lower = response.lower()
        for pattern, weight in self.preference_patterns.items():
            if pattern in response_lower or self._check_quality(response, pattern):
                score += 0.1 * weight

        return min(1.0, score)

    def _check_quality(self, response: str, quality: str) -> bool:
        """Check for quality indicators"""
        if quality == "helpful":
            return len(response) > 50 and "?" not in response[-20:]
        elif quality == "detailed":
            return len(response) > 200
        elif quality == "concise":
            return len(response) < 100
        return False

    def compare(self, prompt: str, response_a: str, response_b: str) -> str:
        """Compare two responses"""
        score_a = self.score(prompt, response_a)
        score_b = self.score(prompt, response_b)

        if score_a > score_b:
            return "A"
        elif score_b > score_a:
            return "B"
        return "tie"
```

## Stage 3: PPO Optimization

```python
@dataclass
class PPOConfig:
    """Configuration for PPO training"""
    learning_rate: float = 1e-5
    batch_size: int = 64
    epochs: int = 4
    clip_range: float = 0.2
    value_coef: float = 0.5
    entropy_coef: float = 0.01
    kl_penalty: float = 0.1  # Penalty for diverging from SFT model

class PPOTrainingConcept:
    """Conceptual illustration of PPO training for RLHF"""

    def __init__(self, config: PPOConfig):
        self.config = config

    def describe_training_loop(self) -> str:
        return """
PPO Training Loop for RLHF:

1. SAMPLE: Generate responses from current policy
   - Input prompts from training set
   - Model generates completions

2. REWARD: Score responses using reward model
   - Reward model evaluates each response
   - KL penalty added to prevent drift from SFT model

3. COMPUTE ADVANTAGES:
   - Calculate how much better/worse than expected
   - Advantage = Reward - Baseline

4. UPDATE POLICY:
   - Compute policy gradient
   - Apply PPO clipping to stabilize updates
   - Update model weights

5. REPEAT until convergence
"""

    def compute_reward_with_kl(
        self,
        reward_score: float,
        log_prob_current: float,
        log_prob_reference: float
    ) -> float:
        """Compute reward with KL penalty"""
        kl_divergence = log_prob_current - log_prob_reference
        penalized_reward = reward_score - self.config.kl_penalty * kl_divergence
        return penalized_reward

    def ppo_objective(
        self,
        advantage: float,
        ratio: float  # pi(a|s) / pi_old(a|s)
    ) -> float:
        """Compute clipped PPO objective"""
        unclipped = ratio * advantage
        clipped = (
            max(1 - self.config.clip_range, min(1 + self.config.clip_range, ratio))
            * advantage
        )
        return min(unclipped, clipped)
```

## RLHF Challenges and Considerations

```python
class RLHFChallenges:
    """Common challenges in RLHF"""

    @staticmethod
    def get_challenges() -> List[Dict]:
        return [
            {
                "name": "Reward Hacking",
                "description": "Model finds shortcuts to maximize reward without genuine improvement",
                "mitigation": "Diverse reward signals, regularization, human oversight"
            },
            {
                "name": "Distribution Shift",
                "description": "Model drifts too far from base capabilities",
                "mitigation": "KL penalty, reference model constraints"
            },
            {
                "name": "Annotation Quality",
                "description": "Human preferences are noisy and inconsistent",
                "mitigation": "Multiple annotators, clear guidelines, quality checks"
            },
            {
                "name": "Scalability",
                "description": "Human feedback is expensive and slow to collect",
                "mitigation": "Constitutional AI, automated evaluation, active learning"
            },
            {
                "name": "Goodhart's Law",
                "description": "Optimizing proxy (reward model) degrades true objective",
                "mitigation": "Diverse metrics, regular retraining, human evaluation"
            }
        ]

    @staticmethod
    def best_practices() -> List[str]:
        return [
            "Start with high-quality SFT data before RLHF",
            "Use diverse prompts covering many use cases",
            "Collect preferences from multiple annotators",
            "Monitor for reward hacking during training",
            "Maintain KL constraint to preserve capabilities",
            "Regularly evaluate on held-out human judgments",
            "Consider Constitutional AI for scalability",
            "Balance helpfulness with safety constraints"
        ]
```

## Implementing RLHF Concepts

```python
class SimpleRLHFDemo:
    """Simplified demonstration of RLHF concepts"""

    def __init__(self):
        self.reward_model = ConceptualRewardModel()
        self.policy_responses = {}

    def generate_responses(self, prompts: List[str], model) -> Dict[str, str]:
        """Generate responses for prompts"""
        responses = {}
        for prompt in prompts:
            # In practice, this would call the actual model
            responses[prompt] = model.generate(prompt)
        return responses

    def compute_rewards(self, prompt_responses: Dict[str, str]) -> Dict[str, float]:
        """Compute rewards for responses"""
        rewards = {}
        for prompt, response in prompt_responses.items():
            rewards[prompt] = self.reward_model.score(prompt, response)
        return rewards

    def select_best_responses(
        self,
        prompts: List[str],
        n_samples: int = 4
    ) -> Dict[str, Tuple[str, float]]:
        """Best-of-N sampling using reward model"""
        best_responses = {}

        for prompt in prompts:
            candidates = []
            for _ in range(n_samples):
                # Generate multiple responses
                response = f"Sample response for: {prompt}"  # Placeholder
                score = self.reward_model.score(prompt, response)
                candidates.append((response, score))

            # Select best
            best = max(candidates, key=lambda x: x[1])
            best_responses[prompt] = best

        return best_responses

# Usage demonstration
demo = SimpleRLHFDemo()

# Illustrate best-of-N sampling (a simpler alternative to full PPO)
prompts = [
    "Explain machine learning",
    "Write a poem about nature"
]

best = demo.select_best_responses(prompts, n_samples=4)
for prompt, (response, score) in best.items():
    print(f"Prompt: {prompt}")
    print(f"Best score: {score:.2f}")
```

## Conclusion

RLHF is a powerful technique for aligning LLMs with human preferences through a three-stage process: supervised fine-tuning, reward model training, and PPO optimization. Understanding these concepts helps in building and improving AI systems that better serve user needs while maintaining safety and helpfulness.

