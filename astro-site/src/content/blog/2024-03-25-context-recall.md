---
title: "Context Recall in RAG: Are You Finding All Relevant Documents?"
author: "Michael John Peña"
draft: false
date: 2024-03-25
tags: ["AI", "RAG", "Retrieval", "Evaluation", "Search"]

---

I wrote "Context Recall in RAG: Are You Finding All Relevant Documents?" to share practical, production-minded guidance on this topic.

While context precision measures noise in retrieved results, context recall measures completeness. Are you retrieving all the documents needed to fully answer the question?

## Understanding Context Recall

```python
from dataclasses import dataclass
from typing import List, Dict, Set
import anthropic

@dataclass
class ContextRecallResult:
    score: float  # 0-1
    ground_truth_statements: List[str]
    statement_attributions: List[Dict]  # {statement, attributed, source_doc}
    attributed_count: int
    total_statements: int

class ContextRecallEvaluator:
    """
    Context Recall measures whether all information needed
    to answer the question is present in retrieved documents.

    Recall = Statements from Ground Truth attributed to Context / Total Statements

    Unlike traditional recall which needs labeled relevant docs,
    this uses ground truth answer to derive what should be retrieved.
    """

    def __init__(self):
        self.client = anthropic.Anthropic()

    def extract_statements(self, text: str) -> List[str]:
        """
        Extract factual statements from ground truth answer
        """
        prompt = f"""Extract all factual statements from this text.
Each statement should be atomic and independently verifiable.

Text: {text}

List each statement on a new line:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        statements = []
        for line in response.content[0].text.strip().split('\n'):
            line = line.strip().lstrip('0123456789.-) ')
            if line:
                statements.append(line)

        return statements

    def can_attribute_to_context(
        self,
        statement: str,
        contexts: List[str]
    ) -> Dict:
        """
        Check if a statement can be attributed to the retrieved context
        """
        combined_context = "\n\n---\n\n".join(contexts)

        prompt = f"""Can this statement be attributed to (found in or inferred from) the given context?

Statement: {statement}

Context:
{combined_context}

If YES, respond: ATTRIBUTED: [quote or reference from context]
If NO, respond: NOT ATTRIBUTED: [reason]"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text.strip()
        is_attributed = text.upper().startswith("ATTRIBUTED")

        return {
            "attributed": is_attributed,
            "evidence": text.split(":", 1)[1].strip() if ":" in text else text
        }

    def evaluate(
        self,
        ground_truth_answer: str,
        retrieved_contexts: List[str]
    ) -> ContextRecallResult:
        """
        Calculate context recall
        """
        # Extract statements from ground truth
        statements = self.extract_statements(ground_truth_answer)

        if not statements:
            return ContextRecallResult(
                score=1.0,  # No statements to verify
                ground_truth_statements=[],
                statement_attributions=[],
                attributed_count=0,
                total_statements=0
            )

        # Check attribution for each statement
        attributions = []
        attributed_count = 0

        for stmt in statements:
            result = self.can_attribute_to_context(stmt, retrieved_contexts)
            attributions.append({
                "statement": stmt,
                "attributed": result["attributed"],
                "evidence": result["evidence"]
            })

            if result["attributed"]:
                attributed_count += 1

        score = attributed_count / len(statements)

        return ContextRecallResult(
            score=score,
            ground_truth_statements=statements,
            statement_attributions=attributions,
            attributed_count=attributed_count,
            total_statements=len(statements)
        )
```

## Question-Based Context Recall

```python
class QuestionBasedRecallEvaluator:
    """
    Alternative approach: Generate sub-questions from the main question
    and check if context can answer them
    """

    def __init__(self):
        self.client = anthropic.Anthropic()

    def decompose_question(self, question: str) -> List[str]:
        """
        Break question into sub-questions
        """
        prompt = f"""Break this question into specific sub-questions or information needs.
What pieces of information would be needed to fully answer this question?

Question: {question}

List sub-questions:"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        sub_questions = []
        for line in response.content[0].text.strip().split('\n'):
            line = line.strip().lstrip('0123456789.-) ')
            if line and len(line) > 10:  # Filter very short lines
                sub_questions.append(line)

        return sub_questions

    def can_answer_from_context(
        self,
        sub_question: str,
        contexts: List[str]
    ) -> Dict:
        """
        Check if sub-question can be answered from context
        """
        combined = "\n\n".join(contexts)

        prompt = f"""Based on the provided context, can this question be answered?

Question: {sub_question}

Context:
{combined}

If YES: Provide a brief answer from the context
If NO: Explain what information is missing

Response (start with YES or NO):"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text.strip()
        can_answer = text.upper().startswith("YES")

        return {
            "answerable": can_answer,
            "detail": text
        }

    def evaluate(
        self,
        question: str,
        retrieved_contexts: List[str]
    ) -> Dict:
        """
        Calculate question-based recall
        """
        sub_questions = self.decompose_question(question)

        if not sub_questions:
            return {"score": 1.0, "sub_questions": [], "details": []}

        details = []
        answerable_count = 0

        for sq in sub_questions:
            result = self.can_answer_from_context(sq, retrieved_contexts)
            details.append({
                "sub_question": sq,
                "answerable": result["answerable"],
                "detail": result["detail"]
            })

            if result["answerable"]:
                answerable_count += 1

        return {
            "score": answerable_count / len(sub_questions),
            "answerable_count": answerable_count,
            "total_sub_questions": len(sub_questions),
            "details": details
        }
```

## Traditional Recall with Known Relevance

```python
class TraditionalRecallEvaluator:
    """
    When relevant document IDs are known (labeled dataset),
    calculate traditional recall
    """

    def evaluate(
        self,
        retrieved_doc_ids: List[str],
        relevant_doc_ids: Set[str],
        k: int = None
    ) -> Dict[str, float]:
        """
        Calculate traditional recall metrics
        """
        if k:
            retrieved_set = set(retrieved_doc_ids[:k])
        else:
            retrieved_set = set(retrieved_doc_ids)

        relevant_set = relevant_doc_ids

        # True positives: relevant docs that were retrieved
        true_positives = len(retrieved_set & relevant_set)

        # Recall = TP / (TP + FN) = TP / Total Relevant
        recall = true_positives / len(relevant_set) if relevant_set else 0.0

        # Calculate recall at various k
        recall_at_k = {}
        for k_val in [1, 3, 5, 10, 20]:
            if k_val <= len(retrieved_doc_ids):
                retrieved_at_k = set(retrieved_doc_ids[:k_val])
                tp_at_k = len(retrieved_at_k & relevant_set)
                recall_at_k[f"R@{k_val}"] = tp_at_k / len(relevant_set) if relevant_set else 0.0

        return {
            "recall": recall,
            "true_positives": true_positives,
            "total_relevant": len(relevant_set),
            **recall_at_k
        }
```

## Combined Precision-Recall Analysis

```python
class PrecisionRecallAnalyzer:
    """
    Analyze both precision and recall together
    """

    def __init__(self):
        self.precision_eval = ContextPrecisionEvaluator()
        self.recall_eval = ContextRecallEvaluator()

    def evaluate(
        self,
        question: str,
        retrieved_contexts: List[str],
        ground_truth_answer: str
    ) -> Dict:
        """
        Complete precision-recall evaluation
        """
        # Precision
        precision_result = self.precision_eval.evaluate(
            question,
            retrieved_contexts
        )

        # Recall
        recall_result = self.recall_eval.evaluate(
            ground_truth_answer,
            retrieved_contexts
        )

        # F1 Score
        p = precision_result.score
        r = recall_result.score
        f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0.0

        return {
            "precision": p,
            "recall": r,
            "f1": f1,
            "precision_details": {
                "relevant_docs": precision_result.relevant_count,
                "total_retrieved": precision_result.total_count
            },
            "recall_details": {
                "attributed_statements": recall_result.attributed_count,
                "total_statements": recall_result.total_statements,
                "missing_info": [
                    attr["statement"]
                    for attr in recall_result.statement_attributions
                    if not attr["attributed"]
                ]
            }
        }
```

## Practical Example

```python
# Example: Evaluating retrieval for a technical question
question = "What are the steps to deploy a containerized application to AKS?"

ground_truth = """To deploy to AKS:
1. Build your Docker image
2. Push the image to Azure Container Registry
3. Create an AKS cluster using az aks create
4. Configure kubectl to connect to your cluster
5. Create Kubernetes deployment YAML
6. Apply the deployment using kubectl apply"""

retrieved_docs = [
    "Azure Container Registry (ACR) stores Docker images. Push with: docker push myacr.azurecr.io/myapp:v1",
    "Create AKS cluster: az aks create --resource-group myRG --name myAKS --node-count 3",
    "Kubectl connects to clusters. Get credentials: az aks get-credentials --name myAKS"
]

# This retrieval is missing: Docker build instructions, deployment YAML, kubectl apply

# Evaluate
analyzer = PrecisionRecallAnalyzer()
result = analyzer.evaluate(question, retrieved_docs, ground_truth)

print(f"Precision: {result['precision']:.2f}")
print(f"Recall: {result['recall']:.2f}")
print(f"F1: {result['f1']:.2f}")
print(f"\nMissing information:")
for missing in result['recall_details']['missing_info']:
    print(f"  - {missing}")
```

## Conclusion

Context recall ensures your RAG system retrieves all necessary information. Low recall means the generator cannot provide complete answers. Balance recall with precision to avoid overwhelming the generator with irrelevant documents.

