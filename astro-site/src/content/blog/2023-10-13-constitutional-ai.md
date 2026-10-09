---
title: "Constitutional AI: Self-Supervised Alignment"
author: Michael John Peña
draft: false
date: 2023-10-13
description: "Understanding Constitutional AI and how it enables scalable alignment through self-critique and revision."
tags:
  - Constitutional AI
  - AI Safety
  - AI Alignment
  - Anthropic
  - AI
---

## Introduction

Constitutional AI (CAI) is an approach developed by Anthropic that uses a set of principles (a "constitution") to guide AI behavior through self-critique and revision. This reduces reliance on human feedback while improving alignment at scale.

## Constitutional AI Overview

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class ConstitutionalPrinciple:
    """A principle in the AI constitution"""
    name: str
    description: str
    critique_prompt: str
    revision_prompt: str

class Constitution:
    """A collection of principles guiding AI behavior"""

    def __init__(self, name: str):
        self.name = name
        self.principles: List[ConstitutionalPrinciple] = []

    def add_principle(self, principle: ConstitutionalPrinciple):
        self.principles.append(principle)

    def get_principle_names(self) -> List[str]:
        return [p.name for p in self.principles]

# Example constitution based on Anthropic's approach
def create_helpful_harmless_honest_constitution() -> Constitution:
    """Create HHH-based constitution"""
    constitution = Constitution("HHH Constitution")

    constitution.add_principle(ConstitutionalPrinciple(
        name="Harmlessness",
        description="Avoid generating harmful, dangerous, or illegal content",
        critique_prompt="Identify any harmful, dangerous, unethical, or illegal content in this response.",
        revision_prompt="Revise the response to remove harmful content while remaining helpful."
    ))

    constitution.add_principle(ConstitutionalPrinciple(
        name="Helpfulness",
        description="Provide useful, accurate, and relevant information",
        critique_prompt="Does this response adequately address the user's question? Is it accurate and useful?",
        revision_prompt="Revise to make the response more helpful and accurate."
    ))

    constitution.add_principle(ConstitutionalPrinciple(
        name="Honesty",
        description="Be truthful and acknowledge uncertainty",
        critique_prompt="Is this response honest? Does it acknowledge limitations or uncertainty where appropriate?",
        revision_prompt="Revise to be more honest about limitations and avoid false claims."
    ))

    constitution.add_principle(ConstitutionalPrinciple(
        name="Respectfulness",
        description="Treat users with respect and avoid discrimination",
        critique_prompt="Is this response respectful? Does it avoid bias or discrimination?",
        revision_prompt="Revise to be more respectful and remove any biased language."
    ))

    return constitution
```

## CAI Training Process

```python
class CAIProcess:
    """Constitutional AI training process"""

    @staticmethod
    def describe_stages() -> Dict:
        return {
            "stage_1_critique_revision": {
                "name": "Supervised Learning from AI Feedback (SL-CAI)",
                "steps": [
                    "1. Generate initial response to prompt",
                    "2. Ask model to critique response using principles",
                    "3. Ask model to revise based on critique",
                    "4. Use revised responses for supervised training"
                ],
                "benefit": "Creates training data without human annotation"
            },
            "stage_2_rl_cai": {
                "name": "Reinforcement Learning from AI Feedback (RL-CAI)",
                "steps": [
                    "1. Generate comparison pairs (original vs revised)",
                    "2. Use model to rank pairs based on principles",
                    "3. Train reward model on AI preferences",
                    "4. Use RL to optimize policy"
                ],
                "benefit": "Scales alignment without human preference labels"
            }
        }

class CritiqueRevisionPipeline:
    """Implement critique and revision process"""

    def __init__(self, model, constitution: Constitution):
        self.model = model
        self.constitution = constitution

    def generate_initial_response(self, prompt: str) -> str:
        """Generate initial response"""
        return self.model.generate(prompt)

    def critique(self, prompt: str, response: str, principle: ConstitutionalPrinciple) -> str:
        """Generate critique based on principle"""
        critique_prompt = f"""
Original prompt: {prompt}

Response to critique: {response}

{principle.critique_prompt}

Provide a detailed critique:
"""
        return self.model.generate(critique_prompt)

    def revise(self, prompt: str, response: str, critique: str, principle: ConstitutionalPrinciple) -> str:
        """Revise response based on critique"""
        revision_prompt = f"""
Original prompt: {prompt}

Original response: {response}

Critique: {critique}

{principle.revision_prompt}

Revised response:
"""
        return self.model.generate(revision_prompt)

    def full_revision_chain(self, prompt: str) -> Dict:
        """Run full critique-revision chain"""
        # Initial response
        initial = self.generate_initial_response(prompt)

        revisions = [{"stage": "initial", "response": initial}]

        current_response = initial

        # Apply each principle
        for principle in self.constitution.principles:
            critique = self.critique(prompt, current_response, principle)
            revised = self.revise(prompt, current_response, critique, principle)

            revisions.append({
                "stage": principle.name,
                "critique": critique,
                "response": revised
            })

            current_response = revised

        return {
            "prompt": prompt,
            "initial_response": initial,
            "final_response": current_response,
            "revision_chain": revisions
        }
```

## Practical Implementation

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

class CAIImplementation:
    """Practical CAI implementation using LangChain"""

    def __init__(self, model_name: str = "gpt-4"):
        self.llm = ChatOpenAI(model=model_name, temperature=0.7)
        self.constitution = create_helpful_harmless_honest_constitution()

    def create_critique_chain(self, principle: ConstitutionalPrinciple):
        """Create critique chain for a principle"""
        prompt = ChatPromptTemplate.from_template("""
You are evaluating a response based on this principle: {principle_name}
Description: {principle_description}

Original user prompt: {user_prompt}
Response to evaluate: {response}

{critique_instructions}

Provide a specific, constructive critique. If the response is acceptable, say "No issues found."

Critique:
""")

        return prompt | self.llm

    def create_revision_chain(self, principle: ConstitutionalPrinciple):
        """Create revision chain for a principle"""
        prompt = ChatPromptTemplate.from_template("""
You are revising a response based on this critique and principle: {principle_name}

Original user prompt: {user_prompt}
Original response: {response}
Critique: {critique}

{revision_instructions}

If the critique found no issues, return the original response unchanged.
Otherwise, provide an improved response that addresses the critique.

Revised response:
""")

        return prompt | self.llm

    def apply_constitution(self, user_prompt: str, initial_response: str) -> Dict:
        """Apply full constitution to a response"""
        current_response = initial_response
        revision_history = []

        for principle in self.constitution.principles:
            # Critique
            critique_chain = self.create_critique_chain(principle)
            critique_result = critique_chain.invoke({
                "principle_name": principle.name,
                "principle_description": principle.description,
                "user_prompt": user_prompt,
                "response": current_response,
                "critique_instructions": principle.critique_prompt
            })

            critique = critique_result.content

            # Revision
            revision_chain = self.create_revision_chain(principle)
            revision_result = revision_chain.invoke({
                "principle_name": principle.name,
                "user_prompt": user_prompt,
                "response": current_response,
                "critique": critique,
                "revision_instructions": principle.revision_prompt
            })

            revised = revision_result.content

            revision_history.append({
                "principle": principle.name,
                "critique": critique,
                "revised_response": revised
            })

            current_response = revised

        return {
            "initial_response": initial_response,
            "final_response": current_response,
            "history": revision_history
        }

# Usage
cai = CAIImplementation()

# Example with potentially problematic content
user_prompt = "How can I access someone else's email account?"
initial_response = "You could try guessing their password or using phishing..."

result = cai.apply_constitution(user_prompt, initial_response)
print(f"Final response: {result['final_response']}")
```

## Building Custom Constitutions

```python
class ConstitutionBuilder:
    """Build custom constitutions for specific use cases"""

    def __init__(self, name: str):
        self.constitution = Constitution(name)

    def add_safety_principles(self) -> 'ConstitutionBuilder':
        """Add standard safety principles"""
        self.constitution.add_principle(ConstitutionalPrinciple(
            name="No Harmful Instructions",
            description="Do not provide instructions for harmful activities",
            critique_prompt="Does this response provide instructions that could harm people or property?",
            revision_prompt="Remove any harmful instructions while explaining why you cannot help."
        ))

        self.constitution.add_principle(ConstitutionalPrinciple(
            name="No Illegal Activity",
            description="Do not assist with illegal activities",
            critique_prompt="Does this response assist with any illegal activities?",
            revision_prompt="Revise to refuse illegal requests and suggest legal alternatives."
        ))

        return self

    def add_accuracy_principles(self) -> 'ConstitutionBuilder':
        """Add accuracy and truthfulness principles"""
        self.constitution.add_principle(ConstitutionalPrinciple(
            name="Factual Accuracy",
            description="Ensure factual claims are accurate",
            critique_prompt="Are there any factual errors or misleading claims in this response?",
            revision_prompt="Correct any factual errors and add caveats where uncertain."
        ))

        self.constitution.add_principle(ConstitutionalPrinciple(
            name="Source Attribution",
            description="Acknowledge when information comes from specific sources",
            critique_prompt="Does this response properly attribute information or acknowledge uncertainty?",
            revision_prompt="Add appropriate attribution and acknowledge limitations."
        ))

        return self

    def add_domain_principle(
        self,
        name: str,
        description: str,
        critique: str,
        revision: str
    ) -> 'ConstitutionBuilder':
        """Add custom domain-specific principle"""
        self.constitution.add_principle(ConstitutionalPrinciple(
            name=name,
            description=description,
            critique_prompt=critique,
            revision_prompt=revision
        ))
        return self

    def build(self) -> Constitution:
        return self.constitution

# Example: Customer service constitution
customer_service_constitution = (
    ConstitutionBuilder("Customer Service AI")
    .add_safety_principles()
    .add_domain_principle(
        name="Professional Tone",
        description="Maintain professional and empathetic communication",
        critique="Is this response professional and empathetic?",
        revision="Revise to be more professional while showing empathy."
    )
    .add_domain_principle(
        name="Solution Focused",
        description="Focus on resolving customer issues",
        critique="Does this response help solve the customer's problem?",
        revision="Revise to focus more on actionable solutions."
    )
    .add_domain_principle(
        name="Company Policy Compliance",
        description="Ensure responses align with company policies",
        critique="Does this response align with standard company policies?",
        revision="Revise to comply with company guidelines."
    )
    .build()
)
```

## Evaluation and Monitoring

```python
class CAIEvaluator:
    """Evaluate CAI effectiveness"""

    def __init__(self, constitution: Constitution):
        self.constitution = constitution

    def evaluate_revision(self, initial: str, revised: str, principle: ConstitutionalPrinciple) -> Dict:
        """Evaluate how well revision addressed principle"""
        # In practice, use an evaluator model
        return {
            "principle": principle.name,
            "improvement_detected": initial != revised,
            "initial_length": len(initial),
            "revised_length": len(revised)
        }

    def evaluate_full_chain(self, revision_result: Dict) -> Dict:
        """Evaluate full revision chain"""
        evaluations = []
        total_changes = 0

        for i, entry in enumerate(revision_result["history"]):
            prev_response = (
                revision_result["initial_response"] if i == 0
                else revision_result["history"][i-1]["revised_response"]
            )

            changed = prev_response != entry["revised_response"]
            if changed:
                total_changes += 1

            evaluations.append({
                "principle": entry["principle"],
                "changed": changed,
                "critique_length": len(entry["critique"])
            })

        return {
            "total_principles_applied": len(self.constitution.principles),
            "revisions_made": total_changes,
            "revision_rate": total_changes / len(self.constitution.principles),
            "principle_evaluations": evaluations
        }
```

## Conclusion

Constitutional AI provides a scalable approach to AI alignment by using self-critique and revision guided by explicit principles. By defining clear constitutions and implementing automated revision chains, organizations can improve AI safety and helpfulness without extensive human feedback collection.
