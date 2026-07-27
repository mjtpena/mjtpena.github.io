---
title: "Human Feedback in LLM Development"
author: Michael John Peña
draft: false
date: 2023-10-10
description: "Implementing human feedback systems to improve LLM application quality through user input and expert evaluation."
tags:
  - Human Feedback
  - LLM
  - RLHF
  - Quality Improvement
  - AI

---

I wrote "Human Feedback in LLM Development" to share practical, production-minded guidance on this topic.

## Introduction

Human feedback is essential for improving LLM applications. While automated metrics provide quantitative measurements, human judgment captures nuances that automated systems miss. This post covers implementing human feedback collection and integration systems.

## Feedback Collection Systems

### Feedback Data Models

```python
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import uuid

class FeedbackType(Enum):
    THUMBS = "thumbs"  # Simple up/down
    RATING = "rating"  # 1-5 stars
    COMPARISON = "comparison"  # A vs B
    ANNOTATION = "annotation"  # Detailed markup
    FREE_TEXT = "free_text"  # Open comments

class FeedbackCategory(Enum):
    ACCURACY = "accuracy"
    RELEVANCE = "relevance"
    HELPFULNESS = "helpfulness"
    SAFETY = "safety"
    FORMATTING = "formatting"
    OTHER = "other"

@dataclass
class FeedbackItem:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    feedback_type: FeedbackType = FeedbackType.THUMBS
    timestamp: datetime = field(default_factory=datetime.now)

    # Context
    query: str = ""
    response: str = ""
    context: Optional[str] = None
    model_version: Optional[str] = None

    # Feedback data
    score: Optional[float] = None  # Normalized 0-1
    category: Optional[FeedbackCategory] = None
    comment: Optional[str] = None
    corrections: Optional[str] = None

    # Metadata
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    is_expert: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class ComparisonFeedback(FeedbackItem):
    response_a: str = ""
    response_b: str = ""
    winner: str = ""  # "A", "B", or "tie"
    reasoning: Optional[str] = None

@dataclass
class AnnotationFeedback(FeedbackItem):
    annotations: List[Dict] = field(default_factory=list)
    # Each annotation: {"start": int, "end": int, "type": str, "note": str}
```

### Feedback Collection Interface

```python
from abc import ABC, abstractmethod
import json
import os

class FeedbackCollector(ABC):
    """Abstract base for feedback collection"""

    @abstractmethod
    def collect(self, query: str, response: str, **kwargs) -> FeedbackItem:
        pass

    @abstractmethod
    def store(self, feedback: FeedbackItem):
        pass

class ThumbsFeedbackCollector(FeedbackCollector):
    """Simple thumbs up/down collection"""

    def __init__(self, storage_path: str = "./feedback"):
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)

    def collect(self, query: str, response: str, is_positive: bool, **kwargs) -> FeedbackItem:
        return FeedbackItem(
            feedback_type=FeedbackType.THUMBS,
            query=query,
            response=response,
            score=1.0 if is_positive else 0.0,
            **kwargs
        )

    def store(self, feedback: FeedbackItem):
        filename = f"{self.storage_path}/{feedback.id}.json"
        with open(filename, "w") as f:
            json.dump(self._to_dict(feedback), f, default=str)

    def _to_dict(self, feedback: FeedbackItem) -> Dict:
        return {
            "id": feedback.id,
            "type": feedback.feedback_type.value,
            "timestamp": feedback.timestamp.isoformat(),
            "query": feedback.query,
            "response": feedback.response,
            "score": feedback.score,
            "user_id": feedback.user_id,
            "metadata": feedback.metadata
        }

class RatingFeedbackCollector(FeedbackCollector):
    """Star rating collection (1-5)"""

    def __init__(self, storage_path: str = "./feedback"):
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)

    def collect(
        self,
        query: str,
        response: str,
        rating: int,
        category: FeedbackCategory = FeedbackCategory.HELPFULNESS,
        comment: str = None,
        **kwargs
    ) -> FeedbackItem:
        # Normalize 1-5 to 0-1
        normalized_score = (rating - 1) / 4.0

        return FeedbackItem(
            feedback_type=FeedbackType.RATING,
            query=query,
            response=response,
            score=normalized_score,
            category=category,
            comment=comment,
            **kwargs
        )

    def store(self, feedback: FeedbackItem):
        filename = f"{self.storage_path}/{feedback.id}.json"
        with open(filename, "w") as f:
            json.dump({
                "id": feedback.id,
                "type": feedback.feedback_type.value,
                "timestamp": feedback.timestamp.isoformat(),
                "query": feedback.query,
                "response": feedback.response,
                "score": feedback.score,
                "rating_1_5": int(feedback.score * 4 + 1),
                "category": feedback.category.value if feedback.category else None,
                "comment": feedback.comment,
                "user_id": feedback.user_id
            }, f, default=str)

class ComparisonFeedbackCollector(FeedbackCollector):
    """A/B comparison collection"""

    def __init__(self, storage_path: str = "./feedback"):
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)

    def collect(
        self,
        query: str,
        response_a: str,
        response_b: str,
        winner: str,
        reasoning: str = None,
        **kwargs
    ) -> ComparisonFeedback:
        return ComparisonFeedback(
            feedback_type=FeedbackType.COMPARISON,
            query=query,
            response=response_a,  # For compatibility
            response_a=response_a,
            response_b=response_b,
            winner=winner,
            reasoning=reasoning,
            **kwargs
        )

    def store(self, feedback: ComparisonFeedback):
        filename = f"{self.storage_path}/{feedback.id}.json"
        with open(filename, "w") as f:
            json.dump({
                "id": feedback.id,
                "type": feedback.feedback_type.value,
                "timestamp": feedback.timestamp.isoformat(),
                "query": feedback.query,
                "response_a": feedback.response_a,
                "response_b": feedback.response_b,
                "winner": feedback.winner,
                "reasoning": feedback.reasoning
            }, f, default=str)

# Usage
thumbs_collector = ThumbsFeedbackCollector()
feedback = thumbs_collector.collect(
    query="What is Python?",
    response="Python is a programming language.",
    is_positive=True,
    user_id="user-123"
)
thumbs_collector.store(feedback)
```

### Web-Based Feedback Interface

```python
from flask import Flask, request, jsonify
from dataclasses import asdict

app = Flask(__name__)
collectors = {
    "thumbs": ThumbsFeedbackCollector(),
    "rating": RatingFeedbackCollector(),
    "comparison": ComparisonFeedbackCollector()
}

@app.route("/feedback/thumbs", methods=["POST"])
def submit_thumbs_feedback():
    data = request.json
    feedback = collectors["thumbs"].collect(
        query=data["query"],
        response=data["response"],
        is_positive=data["is_positive"],
        user_id=data.get("user_id"),
        session_id=data.get("session_id")
    )
    collectors["thumbs"].store(feedback)
    return jsonify({"id": feedback.id, "status": "stored"})

@app.route("/feedback/rating", methods=["POST"])
def submit_rating_feedback():
    data = request.json
    feedback = collectors["rating"].collect(
        query=data["query"],
        response=data["response"],
        rating=data["rating"],
        category=FeedbackCategory[data.get("category", "HELPFULNESS").upper()],
        comment=data.get("comment"),
        user_id=data.get("user_id")
    )
    collectors["rating"].store(feedback)
    return jsonify({"id": feedback.id, "status": "stored"})

@app.route("/feedback/comparison", methods=["POST"])
def submit_comparison_feedback():
    data = request.json
    feedback = collectors["comparison"].collect(
        query=data["query"],
        response_a=data["response_a"],
        response_b=data["response_b"],
        winner=data["winner"],
        reasoning=data.get("reasoning"),
        user_id=data.get("user_id")
    )
    collectors["comparison"].store(feedback)
    return jsonify({"id": feedback.id, "status": "stored"})
```

## Feedback Analysis

### Aggregating Feedback

```python
from collections import defaultdict
import glob

class FeedbackAnalyzer:
    """Analyze collected feedback"""

    def __init__(self, storage_path: str = "./feedback"):
        self.storage_path = storage_path

    def load_all_feedback(self) -> List[Dict]:
        """Load all feedback files"""
        feedback_files = glob.glob(f"{self.storage_path}/*.json")
        feedback_items = []

        for filepath in feedback_files:
            with open(filepath, "r") as f:
                feedback_items.append(json.load(f))

        return feedback_items

    def compute_statistics(self) -> Dict:
        """Compute overall statistics"""
        items = self.load_all_feedback()

        if not items:
            return {"error": "No feedback found"}

        stats = {
            "total_feedback": len(items),
            "by_type": defaultdict(int),
            "thumbs_positive_rate": 0,
            "average_rating": 0,
            "comparison_stats": {}
        }

        thumbs_scores = []
        ratings = []
        comparison_winners = defaultdict(int)

        for item in items:
            item_type = item.get("type", "unknown")
            stats["by_type"][item_type] += 1

            if item_type == "thumbs":
                thumbs_scores.append(item.get("score", 0))
            elif item_type == "rating":
                if item.get("score") is not None:
                    ratings.append(item["score"])
            elif item_type == "comparison":
                comparison_winners[item.get("winner", "unknown")] += 1

        if thumbs_scores:
            stats["thumbs_positive_rate"] = sum(thumbs_scores) / len(thumbs_scores)

        if ratings:
            stats["average_rating"] = sum(ratings) / len(ratings)
            stats["average_rating_1_5"] = stats["average_rating"] * 4 + 1

        stats["comparison_stats"] = dict(comparison_winners)

        return stats

    def get_negative_feedback(self, threshold: float = 0.5) -> List[Dict]:
        """Get feedback items below threshold"""
        items = self.load_all_feedback()
        negative = []

        for item in items:
            score = item.get("score")
            if score is not None and score < threshold:
                negative.append(item)

        return negative

    def analyze_by_category(self) -> Dict:
        """Analyze feedback by category"""
        items = self.load_all_feedback()
        by_category = defaultdict(list)

        for item in items:
            category = item.get("category", "unknown")
            if item.get("score") is not None:
                by_category[category].append(item["score"])

        analysis = {}
        for category, scores in by_category.items():
            if scores:
                analysis[category] = {
                    "count": len(scores),
                    "average": sum(scores) / len(scores),
                    "min": min(scores),
                    "max": max(scores)
                }

        return analysis

    def identify_problem_queries(self, min_feedback: int = 3, threshold: float = 0.5) -> List[Dict]:
        """Identify queries that consistently get negative feedback"""
        items = self.load_all_feedback()
        query_scores = defaultdict(list)

        for item in items:
            query = item.get("query", "")
            score = item.get("score")
            if query and score is not None:
                query_scores[query].append(score)

        problems = []
        for query, scores in query_scores.items():
            if len(scores) >= min_feedback:
                avg_score = sum(scores) / len(scores)
                if avg_score < threshold:
                    problems.append({
                        "query": query,
                        "feedback_count": len(scores),
                        "average_score": avg_score
                    })

        return sorted(problems, key=lambda x: x["average_score"])

# Usage
analyzer = FeedbackAnalyzer()

stats = analyzer.compute_statistics()
print(f"Total feedback: {stats['total_feedback']}")
print(f"Thumbs positive rate: {stats['thumbs_positive_rate']:.1%}")
print(f"Average rating: {stats.get('average_rating_1_5', 0):.1f}/5")

# Find problem areas
problems = analyzer.identify_problem_queries()
print(f"\nProblem queries: {len(problems)}")
```

## Using Feedback for Improvement

### Feedback-Driven Prompt Refinement

```python
class FeedbackDrivenOptimizer:
    """Use feedback to improve prompts and responses"""

    def __init__(self, analyzer: FeedbackAnalyzer):
        self.analyzer = analyzer
        self.llm = ChatOpenAI(model="gpt-4")

    def generate_improvement_suggestions(self, n_examples: int = 5) -> str:
        """Generate suggestions based on negative feedback"""
        negative = self.analyzer.get_negative_feedback(threshold=0.5)[:n_examples]

        if not negative:
            return "No significant negative feedback found."

        examples = "\n\n".join([
            f"Query: {item['query']}\nResponse: {item['response']}\nScore: {item['score']:.2f}\nComment: {item.get('comment', 'N/A')}"
            for item in negative
        ])

        prompt = ChatPromptTemplate.from_template("""
        Analyze these low-rated responses and suggest improvements:

        {examples}

        Provide:
        1. Common patterns in low-rated responses
        2. Specific improvements for each example
        3. General recommendations for the system prompt

        Suggestions:
        """)

        result = (prompt | self.llm).invoke({"examples": examples})
        return result.content

    def create_improved_prompt(self, original_prompt: str) -> str:
        """Use feedback to create improved prompt"""
        negative = self.analyzer.get_negative_feedback()[:10]
        categories = self.analyzer.analyze_by_category()

        # Find weakest category
        weakest = min(categories.items(), key=lambda x: x[1]["average"])[0] if categories else "unknown"

        prompt = ChatPromptTemplate.from_template("""
        Improve this prompt based on user feedback analysis.

        Original prompt:
        {original}

        Feedback analysis:
        - Weakest category: {weakest}
        - Sample negative feedback queries: {negative_queries}

        Create an improved prompt that addresses these issues.
        Return only the improved prompt.
        """)

        result = (prompt | self.llm).invoke({
            "original": original_prompt,
            "weakest": weakest,
            "negative_queries": [item["query"] for item in negative[:5]]
        })

        return result.content

# Usage
optimizer = FeedbackDrivenOptimizer(analyzer)
suggestions = optimizer.generate_improvement_suggestions()
print(suggestions)
```

## Expert Annotation Pipeline

```python
@dataclass
class AnnotationTask:
    id: str
    query: str
    response: str
    context: Optional[str]
    assigned_to: Optional[str] = None
    status: str = "pending"  # pending, in_progress, completed
    created_at: datetime = field(default_factory=datetime.now)

class ExpertAnnotationPipeline:
    """Pipeline for expert annotation"""

    def __init__(self, storage_path: str = "./annotations"):
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)
        self.tasks: Dict[str, AnnotationTask] = {}

    def create_task(self, query: str, response: str, context: str = None) -> str:
        """Create annotation task"""
        task = AnnotationTask(
            id=str(uuid.uuid4()),
            query=query,
            response=response,
            context=context
        )
        self.tasks[task.id] = task
        self._save_task(task)
        return task.id

    def assign_task(self, task_id: str, annotator_id: str):
        """Assign task to annotator"""
        if task_id in self.tasks:
            self.tasks[task_id].assigned_to = annotator_id
            self.tasks[task_id].status = "in_progress"
            self._save_task(self.tasks[task_id])

    def submit_annotation(self, task_id: str, annotations: List[Dict], overall_score: float, comments: str = ""):
        """Submit completed annotation"""
        feedback = AnnotationFeedback(
            feedback_type=FeedbackType.ANNOTATION,
            query=self.tasks[task_id].query,
            response=self.tasks[task_id].response,
            annotations=annotations,
            score=overall_score,
            comment=comments,
            is_expert=True
        )

        self.tasks[task_id].status = "completed"
        self._save_annotation(feedback)

        return feedback.id

    def _save_task(self, task: AnnotationTask):
        filepath = f"{self.storage_path}/task_{task.id}.json"
        with open(filepath, "w") as f:
            json.dump(asdict(task), f, default=str)

    def _save_annotation(self, feedback: AnnotationFeedback):
        filepath = f"{self.storage_path}/annotation_{feedback.id}.json"
        with open(filepath, "w") as f:
            json.dump({
                "id": feedback.id,
                "query": feedback.query,
                "response": feedback.response,
                "annotations": feedback.annotations,
                "score": feedback.score,
                "comment": feedback.comment
            }, f)

# Usage
pipeline = ExpertAnnotationPipeline()
task_id = pipeline.create_task(
    query="Explain quantum computing",
    response="Quantum computing uses qubits...",
    context="Educational content for beginners"
)
pipeline.assign_task(task_id, "expert-1")
```

## Conclusion

Human feedback is invaluable for improving LLM applications. By implementing comprehensive feedback collection, analysis, and optimization systems, you can continuously improve response quality based on real user and expert input. The key is making feedback collection frictionless while ensuring the data is actionable for system improvements.

