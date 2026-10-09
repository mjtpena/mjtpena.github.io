---
title: "MMLU Scores Explained: What They Really Mean"
description: "MMLU (Massive Multitask Language Understanding) is one of the most cited LLM benchmarks. Understanding what it measures and its limitations is crucial for…"
author: "Michael John Peña"
draft: false
date: 2024-03-15
tags: ["AI", "LLM", "MMLU", "Benchmarking", "Evaluation"]
---

MMLU (Massive Multitask Language Understanding) is one of the most cited LLM benchmarks. Understanding what it measures and its limitations is crucial for interpreting model comparisons.

## What is MMLU?

MMLU tests knowledge across 57 subjects organized into four categories:

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class MMLUSubject:
    name: str
    category: str
    num_questions: int

MMLU_SUBJECTS = [
    # STEM
    MMLUSubject("abstract_algebra", "STEM", 100),
    MMLUSubject("anatomy", "STEM", 135),
    MMLUSubject("astronomy", "STEM", 152),
    MMLUSubject("college_biology", "STEM", 144),
    MMLUSubject("college_chemistry", "STEM", 100),
    MMLUSubject("college_computer_science", "STEM", 100),
    MMLUSubject("college_mathematics", "STEM", 100),
    MMLUSubject("college_physics", "STEM", 102),
    MMLUSubject("computer_security", "STEM", 100),
    MMLUSubject("electrical_engineering", "STEM", 145),
    MMLUSubject("machine_learning", "STEM", 112),

    # Humanities
    MMLUSubject("formal_logic", "Humanities", 126),
    MMLUSubject("high_school_european_history", "Humanities", 165),
    MMLUSubject("high_school_us_history", "Humanities", 204),
    MMLUSubject("high_school_world_history", "Humanities", 237),
    MMLUSubject("international_law", "Humanities", 121),
    MMLUSubject("jurisprudence", "Humanities", 108),
    MMLUSubject("logical_fallacies", "Humanities", 163),
    MMLUSubject("moral_disputes", "Humanities", 346),
    MMLUSubject("moral_scenarios", "Humanities", 895),
    MMLUSubject("philosophy", "Humanities", 311),
    MMLUSubject("prehistory", "Humanities", 324),
    MMLUSubject("professional_law", "Humanities", 1534),
    MMLUSubject("world_religions", "Humanities", 171),

    # Social Sciences
    MMLUSubject("econometrics", "Social Sciences", 114),
    MMLUSubject("high_school_geography", "Social Sciences", 198),
    MMLUSubject("high_school_government_and_politics", "Social Sciences", 193),
    MMLUSubject("high_school_macroeconomics", "Social Sciences", 390),
    MMLUSubject("high_school_microeconomics", "Social Sciences", 238),
    MMLUSubject("high_school_psychology", "Social Sciences", 545),
    MMLUSubject("human_sexuality", "Social Sciences", 131),
    MMLUSubject("professional_psychology", "Social Sciences", 612),
    MMLUSubject("public_relations", "Social Sciences", 110),
    MMLUSubject("security_studies", "Social Sciences", 245),
    MMLUSubject("sociology", "Social Sciences", 201),
    MMLUSubject("us_foreign_policy", "Social Sciences", 110),

    # Other
    MMLUSubject("business_ethics", "Other", 100),
    MMLUSubject("clinical_knowledge", "Other", 265),
    MMLUSubject("college_medicine", "Other", 173),
    MMLUSubject("global_facts", "Other", 100),
    MMLUSubject("management", "Other", 103),
    MMLUSubject("marketing", "Other", 234),
    MMLUSubject("medical_genetics", "Other", 100),
    MMLUSubject("miscellaneous", "Other", 783),
    MMLUSubject("nutrition", "Other", 306),
    MMLUSubject("professional_accounting", "Other", 282),
    MMLUSubject("professional_medicine", "Other", 272),
    MMLUSubject("virology", "Other", 166),
]

def get_category_stats():
    """Get statistics by category"""
    categories: Dict[str, List[MMLUSubject]] = {}
    for subject in MMLU_SUBJECTS:
        if subject.category not in categories:
            categories[subject.category] = []
        categories[subject.category].append(subject)

    for category, subjects in categories.items():
        total_questions = sum(s.num_questions for s in subjects)
        print(f"{category}: {len(subjects)} subjects, {total_questions} questions")

get_category_stats()
```

## MMLU Question Format

```python
def format_mmlu_question(question: dict) -> str:
    """Format MMLU question for evaluation"""

    formatted = f"""Question: {question['question']}

A) {question['choices'][0]}
B) {question['choices'][1]}
C) {question['choices'][2]}
D) {question['choices'][3]}

Answer:"""

    return formatted

# Example MMLU question
example_question = {
    "question": "What is the time complexity of binary search?",
    "choices": ["O(1)", "O(n)", "O(log n)", "O(n log n)"],
    "answer": 2  # C) O(log n)
}

print(format_mmlu_question(example_question))
```

## Running MMLU Evaluation

```python
import anthropic
import json
from typing import List, Tuple

class MMLUEvaluator:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def evaluate_subject(
        self,
        model: str,
        questions: List[dict],
        few_shot_examples: List[dict] = None
    ) -> Tuple[float, List[dict]]:
        """Evaluate model on MMLU subject"""

        results = []
        correct = 0

        for q in questions:
            # Build prompt
            prompt = ""

            # Add few-shot examples if provided
            if few_shot_examples:
                for ex in few_shot_examples:
                    prompt += format_mmlu_question(ex)
                    answer_letter = chr(65 + ex['answer'])
                    prompt += f" {answer_letter}\n\n"

            prompt += format_mmlu_question(q)

            # Get model response
            response = self.client.messages.create(
                model=model,
                max_tokens=1,
                messages=[{"role": "user", "content": prompt}]
            )

            predicted = response.content[0].text.strip().upper()
            expected = chr(65 + q['answer'])

            is_correct = predicted == expected
            if is_correct:
                correct += 1

            results.append({
                "question": q['question'],
                "predicted": predicted,
                "expected": expected,
                "correct": is_correct
            })

        accuracy = correct / len(questions)
        return accuracy, results

    def evaluate_full_mmlu(
        self,
        model: str,
        dataset: dict,
        num_few_shot: int = 5
    ) -> dict:
        """Evaluate on full MMLU"""

        category_scores = {}
        subject_scores = {}

        for subject_name, data in dataset.items():
            # Use some questions as few-shot examples
            few_shot = data['questions'][:num_few_shot]
            test_questions = data['questions'][num_few_shot:]

            accuracy, _ = self.evaluate_subject(
                model=model,
                questions=test_questions,
                few_shot_examples=few_shot
            )

            subject_scores[subject_name] = accuracy

            # Aggregate by category
            category = data['category']
            if category not in category_scores:
                category_scores[category] = []
            category_scores[category].append(accuracy)

        # Calculate averages
        results = {
            "subject_scores": subject_scores,
            "category_averages": {
                cat: sum(scores) / len(scores)
                for cat, scores in category_scores.items()
            },
            "overall_average": sum(subject_scores.values()) / len(subject_scores)
        }

        return results

# Usage
evaluator = MMLUEvaluator()
# results = evaluator.evaluate_full_mmlu("claude-3-opus-20240229", mmlu_dataset)
```

## Interpreting MMLU Scores

```python
def interpret_mmlu_score(score: float) -> str:
    """Interpret MMLU score in context"""

    if score >= 0.90:
        level = "Expert level"
        context = "Approaching human expert performance"
    elif score >= 0.80:
        level = "Strong performance"
        context = "College graduate level"
    elif score >= 0.70:
        level = "Good performance"
        context = "Undergraduate level"
    elif score >= 0.60:
        level = "Moderate performance"
        context = "High school advanced level"
    elif score >= 0.50:
        level = "Basic performance"
        context = "High school level"
    else:
        level = "Below baseline"
        context = "Random guessing is 25%"

    return f"{level} ({score:.1%}): {context}"

# Model scores interpretation
model_mmlu_scores = {
    "Claude 3 Opus": 0.868,
    "GPT-4 Turbo": 0.864,
    "Claude 3 Sonnet": 0.790,
    "Llama 2 70B": 0.689,
    "Mistral Large": 0.812,
}

for model, score in model_mmlu_scores.items():
    print(f"{model}: {interpret_mmlu_score(score)}")
```

## MMLU Limitations

```python
# Key limitations to consider

limitations = {
    "multiple_choice_bias": """
        MMLU uses multiple choice format, which may not reflect
        real-world task performance where open-ended responses
        are required.
    """,

    "memorization_risk": """
        Popular benchmarks like MMLU may be partially memorized
        by models trained on large internet corpora.
    """,

    "static_knowledge": """
        MMLU tests factual knowledge that may become outdated.
        It doesn't measure reasoning ability directly.
    """,

    "english_only": """
        MMLU is English-only and may not reflect multilingual
        capabilities.
    """,

    "answer_distribution": """
        Uneven answer distribution across questions could allow
        gaming through pattern recognition.
    """
}

def print_limitations():
    print("MMLU Benchmark Limitations:\n")
    for limitation, description in limitations.items():
        print(f"- {limitation.replace('_', ' ').title()}")
        print(f"  {description.strip()}\n")

print_limitations()
```

## Best Practices for Using MMLU

1. **Use alongside other benchmarks** - MMLU alone is insufficient
2. **Consider few-shot vs zero-shot** - Results vary significantly
3. **Look at category breakdowns** - Overall scores hide weaknesses
4. **Test on your domain** - MMLU may not predict task performance

## Conclusion

MMLU provides a useful signal for general knowledge capabilities, but it should be one of many factors in model evaluation. Always validate with domain-specific testing for production use cases.
