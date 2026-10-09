---
title: "AI Orchestration Patterns: Coordinating Multi-Model Systems"
description: "AI orchestration patterns enable building sophisticated AI systems from modular components. The key is designing for reliability, observability, and…"
author: Michael John Pena
draft: false
date: 2023-04-27
tags:
  - AI
  - Orchestration
  - LLM
  - Architecture
  - Python
---

## AI Orchestration Framework

```python
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Callable
from enum import Enum
import asyncio
import json

class StepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class OrchestrationStep:
    name: str
    handler: Callable
    inputs: Dict[str, str]  # Maps input names to previous step outputs
    config: Dict[str, Any]
    retry_count: int = 3
    timeout_seconds: int = 300
    condition: Optional[Callable] = None  # Optional condition to run

@dataclass
class StepResult:
    step_name: str
    status: StepStatus
    output: Any
    duration_seconds: float
    error: Optional[str] = None

class AIOrchestrator:
    """Orchestrate complex AI workflows."""

    def __init__(self, config: dict):
        self.config = config
        self.steps: List[OrchestrationStep] = []
        self.results: Dict[str, StepResult] = {}

    def add_step(
        self,
        name: str,
        handler: Callable,
        inputs: Dict[str, str] = None,
        config: Dict[str, Any] = None,
        retry_count: int = 3,
        timeout_seconds: int = 300,
        condition: Callable = None
    ):
        """Add a step to the orchestration."""
        step = OrchestrationStep(
            name=name,
            handler=handler,
            inputs=inputs or {},
            config=config or {},
            retry_count=retry_count,
            timeout_seconds=timeout_seconds,
            condition=condition
        )
        self.steps.append(step)
        return self

    async def execute(self, initial_input: Any) -> Dict[str, StepResult]:
        """Execute the orchestration pipeline."""
        import time

        self.results = {}
        context = {"input": initial_input}

        for step in self.steps:
            # Check condition
            if step.condition and not step.condition(context):
                self.results[step.name] = StepResult(
                    step_name=step.name,
                    status=StepStatus.SKIPPED,
                    output=None,
                    duration_seconds=0
                )
                continue

            # Prepare inputs
            step_inputs = self._prepare_inputs(step, context)

            # Execute with retry
            start_time = time.time()
            result = await self._execute_with_retry(step, step_inputs)
            duration = time.time() - start_time

            # Store result
            step_result = StepResult(
                step_name=step.name,
                status=StepStatus.COMPLETED if result["success"] else StepStatus.FAILED,
                output=result.get("output"),
                duration_seconds=duration,
                error=result.get("error")
            )
            self.results[step.name] = step_result

            # Update context
            if step_result.status == StepStatus.COMPLETED:
                context[step.name] = step_result.output
            else:
                # Handle failure based on config
                if self.config.get("fail_fast", True):
                    break

        return self.results

    def _prepare_inputs(
        self,
        step: OrchestrationStep,
        context: Dict
    ) -> Dict[str, Any]:
        """Prepare inputs for a step."""
        inputs = {}
        for input_name, source in step.inputs.items():
            if "." in source:
                # Nested access: "step_name.field"
                parts = source.split(".")
                value = context
                for part in parts:
                    value = value.get(part, {}) if isinstance(value, dict) else getattr(value, part, None)
                inputs[input_name] = value
            else:
                inputs[input_name] = context.get(source)
        return inputs

    async def _execute_with_retry(
        self,
        step: OrchestrationStep,
        inputs: Dict
    ) -> Dict:
        """Execute step with retry logic."""

        last_error = None

        for attempt in range(step.retry_count):
            try:
                result = await asyncio.wait_for(
                    step.handler(inputs, step.config),
                    timeout=step.timeout_seconds
                )
                return {"success": True, "output": result}

            except asyncio.TimeoutError:
                last_error = f"Timeout after {step.timeout_seconds}s"
            except Exception as e:
                last_error = str(e)

            # Wait before retry
            await asyncio.sleep(2 ** attempt)

        return {"success": False, "error": last_error}
```

## Multi-Model Orchestration

```python
class MultiModelOrchestrator:
    """Orchestrate multiple AI models."""

    def __init__(self, models: Dict[str, Any]):
        self.models = models

    async def route_to_model(
        self,
        task: str,
        input_data: Any,
        model_selector: Callable = None
    ) -> dict:
        """Route task to appropriate model."""

        if model_selector:
            model_name = model_selector(task, input_data)
        else:
            model_name = await self._auto_select_model(task)

        model = self.models.get(model_name)
        if not model:
            raise ValueError(f"Model {model_name} not found")

        result = await model.process(input_data)

        return {
            "model_used": model_name,
            "result": result
        }

    async def _auto_select_model(self, task: str) -> str:
        """Automatically select model based on task."""
        task_model_mapping = {
            "classification": "fast_classifier",
            "generation": "gpt4",
            "embedding": "ada_embedding",
            "summarization": "gpt35_turbo",
            "translation": "translation_model",
            "sentiment": "sentiment_model"
        }
        return task_model_mapping.get(task, "gpt4")

    async def ensemble_prediction(
        self,
        input_data: Any,
        model_names: List[str],
        aggregation: str = "majority_vote"
    ) -> dict:
        """Get predictions from multiple models and aggregate."""

        # Run models in parallel
        tasks = [
            self.models[name].process(input_data)
            for name in model_names
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter successful results
        successful = [
            (name, result)
            for name, result in zip(model_names, results)
            if not isinstance(result, Exception)
        ]

        # Aggregate
        if aggregation == "majority_vote":
            predictions = [r[1]["prediction"] for r in successful]
            from collections import Counter
            final = Counter(predictions).most_common(1)[0][0]
        elif aggregation == "average":
            scores = [r[1]["score"] for r in successful]
            final = sum(scores) / len(scores)
        else:
            final = [r[1] for r in successful]

        return {
            "individual_results": dict(successful),
            "aggregated_result": final,
            "aggregation_method": aggregation
        }

    async def cascade_models(
        self,
        input_data: Any,
        model_chain: List[str],
        transform_between: Dict[str, Callable] = None
    ) -> dict:
        """Run models in cascade, passing output to next."""

        current_data = input_data
        intermediate_results = []

        for i, model_name in enumerate(model_chain):
            model = self.models[model_name]
            result = await model.process(current_data)

            intermediate_results.append({
                "model": model_name,
                "input": current_data,
                "output": result
            })

            # Transform for next model
            if transform_between and model_name in transform_between:
                current_data = transform_between[model_name](result)
            else:
                current_data = result

        return {
            "final_result": current_data,
            "cascade_results": intermediate_results
        }
```

## LLM Chain Orchestration

```python
class LLMChainOrchestrator:
    """Orchestrate LLM chains for complex reasoning."""

    def __init__(self, llm_client):
        self.client = llm_client

    async def execute_chain(
        self,
        initial_prompt: str,
        chain_steps: List[dict]
    ) -> dict:
        """Execute a chain of LLM calls."""

        context = {"initial_input": initial_prompt}
        results = []

        for step in chain_steps:
            # Build prompt with context
            prompt = self._build_prompt(step["prompt_template"], context)

            # Execute LLM call
            response = await self.client.chat_completion(
                model=step.get("model", "gpt-4"),
                messages=[{"role": "user", "content": prompt}],
                temperature=step.get("temperature", 0.3)
            )

            result = response.content

            # Parse output if specified
            if step.get("output_parser"):
                result = step["output_parser"](result)

            # Store in context
            context[step["name"]] = result
            results.append({
                "step": step["name"],
                "prompt": prompt,
                "response": result
            })

        return {
            "final_output": results[-1]["response"],
            "chain_results": results,
            "context": context
        }

    def _build_prompt(self, template: str, context: dict) -> str:
        """Build prompt from template and context."""
        for key, value in context.items():
            placeholder = f"{{{key}}}"
            if placeholder in template:
                template = template.replace(placeholder, str(value))
        return template

    async def tree_of_thought(
        self,
        problem: str,
        num_branches: int = 3,
        depth: int = 3
    ) -> dict:
        """Implement tree-of-thought reasoning."""

        async def generate_thoughts(context: str, num: int) -> List[str]:
            prompt = f"""Given this problem context, generate {num} different approaches or thoughts.

Context:
{context}

Generate {num} distinct approaches, each on a new line."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7
            )

            return response.content.strip().split("\n")

        async def evaluate_thought(thought: str, problem: str) -> float:
            prompt = f"""Evaluate how promising this thought is for solving the problem.

Problem: {problem}
Thought: {thought}

Rate from 0.0 to 1.0 based on:
- Relevance to problem
- Feasibility
- Potential to lead to solution

Return only the number."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            try:
                return float(response.content.strip())
            except:
                return 0.5

        # Build tree
        root = {"context": problem, "children": [], "score": 1.0}
        current_level = [root]

        for level in range(depth):
            next_level = []

            for node in current_level:
                # Generate thoughts
                thoughts = await generate_thoughts(node["context"], num_branches)

                for thought in thoughts:
                    # Evaluate thought
                    score = await evaluate_thought(thought, problem)

                    child = {
                        "context": f"{node['context']}\nThought: {thought}",
                        "thought": thought,
                        "score": score,
                        "children": []
                    }
                    node["children"].append(child)
                    next_level.append(child)

            # Prune: keep top thoughts
            next_level.sort(key=lambda x: x["score"], reverse=True)
            current_level = next_level[:num_branches]

        # Find best path
        best_path = self._find_best_path(root)

        return {
            "tree": root,
            "best_path": best_path,
            "final_solution": best_path[-1]["thought"] if best_path else None
        }

    def _find_best_path(self, root: dict) -> List[dict]:
        """Find best path through the tree."""
        if not root["children"]:
            return [root]

        best_child = max(root["children"], key=lambda x: x["score"])
        return [root] + self._find_best_path(best_child)
```

## Workflow Orchestration

```python
class AIWorkflowOrchestrator:
    """Orchestrate complete AI workflows."""

    def __init__(self, config: dict):
        self.config = config
        self.workflows = {}

    def define_workflow(
        self,
        name: str,
        steps: List[dict]
    ):
        """Define a reusable workflow."""
        self.workflows[name] = {
            "name": name,
            "steps": steps,
            "created_at": datetime.utcnow().isoformat()
        }

    async def execute_workflow(
        self,
        workflow_name: str,
        input_data: Any,
        callbacks: Dict[str, Callable] = None
    ) -> dict:
        """Execute a defined workflow."""

        workflow = self.workflows.get(workflow_name)
        if not workflow:
            raise ValueError(f"Workflow {workflow_name} not found")

        orchestrator = AIOrchestrator(self.config)

        for step in workflow["steps"]:
            handler = self._get_handler(step["handler"])
            orchestrator.add_step(
                name=step["name"],
                handler=handler,
                inputs=step.get("inputs", {}),
                config=step.get("config", {}),
                retry_count=step.get("retry_count", 3),
                condition=step.get("condition")
            )

        results = await orchestrator.execute(input_data)

        # Execute callbacks
        if callbacks:
            for step_name, callback in callbacks.items():
                if step_name in results:
                    callback(results[step_name])

        return {
            "workflow": workflow_name,
            "results": results,
            "success": all(r.status == StepStatus.COMPLETED for r in results.values())
        }

    def _get_handler(self, handler_name: str) -> Callable:
        """Get handler function by name."""
        handlers = {
            "extract_text": self._extract_text_handler,
            "classify": self._classify_handler,
            "extract_entities": self._extract_entities_handler,
            "generate_summary": self._generate_summary_handler,
            "validate": self._validate_handler
        }
        return handlers.get(handler_name, self._default_handler)

# Usage example
orchestrator = AIWorkflowOrchestrator(config)

# Define document processing workflow
orchestrator.define_workflow(
    "document_analysis",
    steps=[
        {
            "name": "extract",
            "handler": "extract_text",
            "inputs": {"document": "input"}
        },
        {
            "name": "classify",
            "handler": "classify",
            "inputs": {"text": "extract.text"}
        },
        {
            "name": "entities",
            "handler": "extract_entities",
            "inputs": {"text": "extract.text"}
        },
        {
            "name": "summary",
            "handler": "generate_summary",
            "inputs": {"text": "extract.text", "doc_type": "classify.type"}
        },
        {
            "name": "validate",
            "handler": "validate",
            "inputs": {
                "entities": "entities.result",
                "summary": "summary.text"
            }
        }
    ]
)

# Execute workflow
result = await orchestrator.execute_workflow(
    "document_analysis",
    input_data=document_bytes
)
```

## Event-Driven Orchestration

```python
class EventDrivenOrchestrator:
    """Event-driven AI orchestration."""

    def __init__(self):
        self.handlers = {}
        self.event_queue = asyncio.Queue()

    def on(self, event_type: str, handler: Callable):
        """Register event handler."""
        if event_type not in self.handlers:
            self.handlers[event_type] = []
        self.handlers[event_type].append(handler)
        return self

    async def emit(self, event_type: str, data: Any):
        """Emit an event."""
        await self.event_queue.put({
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        })

    async def process_events(self):
        """Process events from queue."""
        while True:
            event = await self.event_queue.get()

            handlers = self.handlers.get(event["type"], [])

            for handler in handlers:
                try:
                    result = await handler(event["data"])

                    # Emit completion event
                    await self.emit(
                        f"{event['type']}.completed",
                        {"original": event, "result": result}
                    )
                except Exception as e:
                    await self.emit(
                        f"{event['type']}.failed",
                        {"original": event, "error": str(e)}
                    )

# Usage
orchestrator = EventDrivenOrchestrator()

# Register handlers
orchestrator.on("document.uploaded", extract_handler)
orchestrator.on("text.extracted", classify_handler)
orchestrator.on("document.classified", entity_handler)
orchestrator.on("entities.extracted", summary_handler)

# Start processing
await orchestrator.emit("document.uploaded", document_data)
```

AI orchestration patterns enable building sophisticated AI systems from modular components. The key is designing for reliability, observability, and graceful failure handling.
