---
title: "LLM Application Testing: Strategies and Frameworks"
author: "Michael John Peña"
draft: false
date: 2023-11-05
tags: ["LLM", "Testing", "AI", "Quality Assurance", "Best Practices"]

---

I wrote "LLM Application Testing: Strategies and Frameworks" to share practical, production-minded guidance on this topic.

Testing LLM applications is a problem that doesn't have a satisfying general-purpose solution yet, and that's worth acknowledging before diving into strategies. The fundamental difficulty: LLM outputs are natural language, correctness isn't binary, and the same input can produce different outputs across runs. Traditional unit testing (assert output == expected_output) is only useful for a narrow slice of LLM behaviour — structured extraction, function call parameter validation, classification tasks with a fixed output space. For everything else, you need evaluation approaches that accept the probabilistic nature of the output: LLM-as-judge evaluation against defined criteria, regression testing on a golden dataset where you detect significant distribution shifts rather than exact matches, and human review pipelines for the cases where automated evaluation has low confidence. The test suite isn't protecting against bugs; it's measuring quality and catching regressions.

## The Testing Challenge

LLM applications face several testing hurdles:
- **Non-deterministic outputs**: Same input can produce different outputs
- **Semantic correctness**: Answers must be factually and contextually correct
- **Quality metrics**: Traditional pass/fail doesn't capture nuance
- **Cost**: Running tests against LLMs incurs API costs

## Testing Framework Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Callable, Optional
from enum import Enum
import json
import time

class TestResult(Enum):
    PASS = "pass"
    FAIL = "fail"
    WARNING = "warning"
    ERROR = "error"

@dataclass
class TestCase:
    name: str
    input: Dict
    expected_behavior: str
    validators: List[Callable]
    tags: List[str] = field(default_factory=list)
    timeout_seconds: float = 30.0

@dataclass
class TestOutcome:
    test_case: TestCase
    result: TestResult
    actual_output: str
    validation_details: List[Dict]
    latency_ms: float
    token_usage: Dict
    error_message: Optional[str] = None

class LLMTestRunner:
    def __init__(self, llm_client, model: str):
        self.client = llm_client
        self.model = model
        self.outcomes: List[TestOutcome] = []

    def run_test(self, test_case: TestCase) -> TestOutcome:
        """Run a single test case."""
        start_time = time.time()
        validation_details = []

        try:
            # Execute LLM call
            response = self.client.chat.completions.create(
                model=self.model,
                messages=test_case.input.get("messages", []),
                temperature=test_case.input.get("temperature", 0),
                max_tokens=test_case.input.get("max_tokens", 1000)
            )

            actual_output = response.choices[0].message.content
            latency_ms = (time.time() - start_time) * 1000

            # Run validators
            all_passed = True
            for validator in test_case.validators:
                result = validator(actual_output, test_case)
                validation_details.append(result)
                if not result.get("passed", False):
                    all_passed = False

            return TestOutcome(
                test_case=test_case,
                result=TestResult.PASS if all_passed else TestResult.FAIL,
                actual_output=actual_output,
                validation_details=validation_details,
                latency_ms=latency_ms,
                token_usage={
                    "prompt": response.usage.prompt_tokens,
                    "completion": response.usage.completion_tokens
                }
            )

        except Exception as e:
            return TestOutcome(
                test_case=test_case,
                result=TestResult.ERROR,
                actual_output="",
                validation_details=[],
                latency_ms=(time.time() - start_time) * 1000,
                token_usage={},
                error_message=str(e)
            )

    def run_suite(self, test_cases: List[TestCase]) -> List[TestOutcome]:
        """Run a suite of test cases."""
        self.outcomes = []
        for test_case in test_cases:
            outcome = self.run_test(test_case)
            self.outcomes.append(outcome)
        return self.outcomes

    def generate_report(self) -> Dict:
        """Generate test report."""
        passed = sum(1 for o in self.outcomes if o.result == TestResult.PASS)
        failed = sum(1 for o in self.outcomes if o.result == TestResult.FAIL)
        errors = sum(1 for o in self.outcomes if o.result == TestResult.ERROR)

        total_tokens = sum(
            o.token_usage.get("prompt", 0) + o.token_usage.get("completion", 0)
            for o in self.outcomes
        )

        return {
            "summary": {
                "total": len(self.outcomes),
                "passed": passed,
                "failed": failed,
                "errors": errors,
                "pass_rate": passed / len(self.outcomes) * 100 if self.outcomes else 0
            },
            "performance": {
                "avg_latency_ms": sum(o.latency_ms for o in self.outcomes) / len(self.outcomes) if self.outcomes else 0,
                "total_tokens": total_tokens
            },
            "details": [
                {
                    "name": o.test_case.name,
                    "result": o.result.value,
                    "latency_ms": o.latency_ms,
                    "error": o.error_message
                }
                for o in self.outcomes
            ]
        }
```

## Validation Strategies

### Semantic Validators

```python
class SemanticValidators:
    def __init__(self, llm_client):
        self.client = llm_client

    def contains_keywords(self, keywords: List[str], case_sensitive: bool = False):
        """Validate output contains specified keywords."""
        def validator(output: str, test_case: TestCase) -> Dict:
            check_output = output if case_sensitive else output.lower()
            check_keywords = keywords if case_sensitive else [k.lower() for k in keywords]

            found = [k for k in check_keywords if k in check_output]
            missing = [k for k in check_keywords if k not in check_output]

            return {
                "validator": "contains_keywords",
                "passed": len(missing) == 0,
                "found_keywords": found,
                "missing_keywords": missing
            }
        return validator

    def excludes_keywords(self, forbidden: List[str], case_sensitive: bool = False):
        """Validate output doesn't contain forbidden keywords."""
        def validator(output: str, test_case: TestCase) -> Dict:
            check_output = output if case_sensitive else output.lower()
            check_forbidden = forbidden if case_sensitive else [f.lower() for f in forbidden]

            found_forbidden = [f for f in check_forbidden if f in check_output]

            return {
                "validator": "excludes_keywords",
                "passed": len(found_forbidden) == 0,
                "found_forbidden": found_forbidden
            }
        return validator

    def matches_format(self, format_type: str):
        """Validate output matches expected format."""
        def validator(output: str, test_case: TestCase) -> Dict:
            if format_type == "json":
                try:
                    json.loads(output)
                    return {"validator": "matches_format", "passed": True, "format": "json"}
                except json.JSONDecodeError as e:
                    return {"validator": "matches_format", "passed": False, "error": str(e)}

            elif format_type == "markdown":
                has_headers = "#" in output
                has_structure = any(marker in output for marker in ["- ", "* ", "1. ", "```"])
                passed = has_headers or has_structure
                return {"validator": "matches_format", "passed": passed, "format": "markdown"}

            return {"validator": "matches_format", "passed": False, "error": f"Unknown format: {format_type}"}
        return validator

    def llm_judge(self, criteria: str, threshold: float = 0.7):
        """Use LLM to judge output quality."""
        def validator(output: str, test_case: TestCase) -> Dict:
            judge_prompt = f"""Evaluate the following response against these criteria:

Criteria: {criteria}

Response to evaluate:
{output}

Rate from 0.0 to 1.0 how well the response meets the criteria.
Respond with only a decimal number."""

            response = self.client.chat.completions.create(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": judge_prompt}],
                temperature=0,
                max_tokens=10
            )

            try:
                score = float(response.choices[0].message.content.strip())
            except ValueError:
                score = 0.0

            return {
                "validator": "llm_judge",
                "passed": score >= threshold,
                "score": score,
                "threshold": threshold,
                "criteria": criteria
            }
        return validator

    def factual_consistency(self, reference_facts: List[str]):
        """Check factual consistency with reference."""
        def validator(output: str, test_case: TestCase) -> Dict:
            facts_str = "\n".join(f"- {fact}" for fact in reference_facts)

            prompt = f"""Check if the following response is consistent with these facts:

Reference Facts:
{facts_str}

Response:
{output}

List any contradictions or inconsistencies. If fully consistent, respond "CONSISTENT".
"""

            response = self.client.chat.completions.create(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=200
            )

            result = response.choices[0].message.content.strip()
            is_consistent = "CONSISTENT" in result.upper()

            return {
                "validator": "factual_consistency",
                "passed": is_consistent,
                "analysis": result
            }
        return validator

# Usage
validators = SemanticValidators(openai_client)

test_case = TestCase(
    name="test_policy_question",
    input={
        "messages": [
            {"role": "system", "content": "You are an HR assistant."},
            {"role": "user", "content": "What is the vacation policy?"}
        ]
    },
    expected_behavior="Should explain vacation days, accrual, and approval process",
    validators=[
        validators.contains_keywords(["vacation", "days", "accrual"]),
        validators.excludes_keywords(["I don't know", "uncertain"]),
        validators.llm_judge("Response is helpful, accurate, and professional", threshold=0.8)
    ],
    tags=["hr", "policies"]
)
```

## Regression Testing

```python
class RegressionTestManager:
    def __init__(self, storage_path: str):
        self.storage_path = storage_path
        self.baseline_results: Dict = {}

    def save_baseline(self, test_name: str, outcomes: List[TestOutcome]):
        """Save test outcomes as baseline for regression."""
        baseline = {
            "timestamp": time.time(),
            "outcomes": [
                {
                    "name": o.test_case.name,
                    "output": o.actual_output,
                    "result": o.result.value,
                    "latency_ms": o.latency_ms
                }
                for o in outcomes
            ]
        }

        baseline_file = f"{self.storage_path}/{test_name}_baseline.json"
        with open(baseline_file, "w") as f:
            json.dump(baseline, f, indent=2)

    def load_baseline(self, test_name: str) -> Optional[Dict]:
        """Load baseline results."""
        baseline_file = f"{self.storage_path}/{test_name}_baseline.json"
        try:
            with open(baseline_file, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            return None

    def compare_with_baseline(
        self,
        test_name: str,
        current_outcomes: List[TestOutcome],
        similarity_threshold: float = 0.9
    ) -> Dict:
        """Compare current results with baseline."""
        baseline = self.load_baseline(test_name)
        if not baseline:
            return {"error": "No baseline found"}

        regressions = []
        improvements = []

        baseline_by_name = {o["name"]: o for o in baseline["outcomes"]}

        for outcome in current_outcomes:
            baseline_outcome = baseline_by_name.get(outcome.test_case.name)
            if not baseline_outcome:
                continue

            # Check for result regression
            if baseline_outcome["result"] == "pass" and outcome.result != TestResult.PASS:
                regressions.append({
                    "test": outcome.test_case.name,
                    "type": "result_regression",
                    "baseline": baseline_outcome["result"],
                    "current": outcome.result.value
                })

            # Check for significant latency regression
            if outcome.latency_ms > baseline_outcome["latency_ms"] * 1.5:
                regressions.append({
                    "test": outcome.test_case.name,
                    "type": "latency_regression",
                    "baseline_ms": baseline_outcome["latency_ms"],
                    "current_ms": outcome.latency_ms
                })

            # Check for improvements
            if baseline_outcome["result"] != "pass" and outcome.result == TestResult.PASS:
                improvements.append({
                    "test": outcome.test_case.name,
                    "type": "result_improvement"
                })

        return {
            "regressions": regressions,
            "improvements": improvements,
            "has_regressions": len(regressions) > 0
        }

# Usage
regression_manager = RegressionTestManager("./test_baselines")

# Save initial baseline
regression_manager.save_baseline("qa_tests", outcomes)

# Later, compare new results
comparison = regression_manager.compare_with_baseline("qa_tests", new_outcomes)
if comparison.get("has_regressions"):
    print("Regressions detected!")
    for reg in comparison["regressions"]:
        print(f"  - {reg['test']}: {reg['type']}")
```

## Cost-Efficient Testing

```python
class TestOptimizer:
    def __init__(self):
        self.test_history: Dict[str, List[Dict]] = {}

    def should_run_test(
        self,
        test_case: TestCase,
        change_context: Dict
    ) -> bool:
        """Determine if test should run based on change context."""
        # Always run tests tagged as critical
        if "critical" in test_case.tags:
            return True

        # Check if changes affect this test's domain
        changed_files = change_context.get("changed_files", [])
        test_domains = test_case.tags

        for domain in test_domains:
            for file in changed_files:
                if domain in file.lower():
                    return True

        # Skip if test has been stable
        history = self.test_history.get(test_case.name, [])
        if len(history) >= 5:
            recent_results = [h["result"] for h in history[-5:]]
            if all(r == "pass" for r in recent_results):
                return False

        return True

    def prioritize_tests(
        self,
        test_cases: List[TestCase],
        change_context: Dict
    ) -> List[TestCase]:
        """Prioritize tests based on likelihood of failure."""
        scored_tests = []

        for tc in test_cases:
            score = 0

            # Critical tests first
            if "critical" in tc.tags:
                score += 100

            # Recently failed tests
            history = self.test_history.get(tc.name, [])
            if history and history[-1]["result"] != "pass":
                score += 50

            # Tests related to changed code
            changed_files = change_context.get("changed_files", [])
            for tag in tc.tags:
                if any(tag in f.lower() for f in changed_files):
                    score += 30

            scored_tests.append((score, tc))

        # Sort by score descending
        scored_tests.sort(key=lambda x: x[0], reverse=True)
        return [tc for _, tc in scored_tests]

# Usage
optimizer = TestOptimizer()

# Filter and prioritize tests
runnable_tests = [
    tc for tc in all_tests
    if optimizer.should_run_test(tc, {"changed_files": ["rag_pipeline.py"]})
]

prioritized = optimizer.prioritize_tests(runnable_tests, change_context)
```

## Conclusion

Testing LLM applications requires a shift in mindset from exact matching to semantic validation. Key principles:

1. **Use semantic validators** that understand meaning, not just text
2. **Implement regression testing** to catch quality degradation
3. **Optimize test runs** to manage costs
4. **Track metrics over time** to identify trends

Build your test suite incrementally, starting with critical paths and expanding coverage as your application matures.

