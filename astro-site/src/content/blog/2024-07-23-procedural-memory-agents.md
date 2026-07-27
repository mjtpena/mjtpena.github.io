---
title: "Procedural Memory for AI Agents: Learning How To Do Things"
author: Michael John Peña
draft: false
date: 2024-07-23
tags:
  - AI
  - Agents
  - Memory
  - Procedural
  - Automation

---

I wrote "Procedural Memory for AI Agents: Learning How To Do Things" to share practical, production-minded guidance on this topic.

## What is Procedural Memory?

Procedural memory captures:
- **Action sequences**: Steps to accomplish tasks
- **Conditions**: When procedures apply
- **Parameters**: Variables in the process
- **Success criteria**: How to know it worked

## Procedure Structure

```python
from dataclasses import dataclass, field
from typing import Callable, Any, Optional
from datetime import datetime
import json

@dataclass
class ProcedureStep:
    action: str
    parameters: dict
    expected_output: str
    error_handling: str = ""
    timeout_seconds: int = 30

@dataclass
class Procedure:
    id: str
    name: str
    description: str
    trigger_conditions: list[str]
    steps: list[ProcedureStep]
    success_criteria: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    execution_count: int = 0
    success_count: int = 0
    avg_duration_seconds: float = 0.0
    parameters_schema: dict = field(default_factory=dict)

    @property
    def success_rate(self) -> float:
        if self.execution_count == 0:
            return 0.0
        return self.success_count / self.execution_count

    def matches_context(self, context: dict) -> bool:
        """Check if this procedure applies to the given context."""
        context_str = json.dumps(context).lower()
        return any(
            trigger.lower() in context_str
            for trigger in self.trigger_conditions
        )
```

## Procedural Memory Store

```python
from langchain_openai import AzureOpenAIEmbeddings
import uuid

class ProceduralMemoryStore:
    def __init__(self, storage_client, embeddings: AzureOpenAIEmbeddings):
        self.storage = storage_client
        self.embeddings = embeddings
        self.procedures: dict[str, Procedure] = {}

    def add_procedure(
        self,
        name: str,
        description: str,
        steps: list[dict],
        trigger_conditions: list[str],
        success_criteria: str,
        parameters_schema: dict = None
    ) -> str:
        """Add a new procedure."""
        proc_id = str(uuid.uuid4())

        procedure_steps = [
            ProcedureStep(
                action=s["action"],
                parameters=s.get("parameters", {}),
                expected_output=s.get("expected_output", ""),
                error_handling=s.get("error_handling", ""),
                timeout_seconds=s.get("timeout_seconds", 30)
            )
            for s in steps
        ]

        procedure = Procedure(
            id=proc_id,
            name=name,
            description=description,
            trigger_conditions=trigger_conditions,
            steps=procedure_steps,
            success_criteria=success_criteria,
            parameters_schema=parameters_schema or {}
        )

        self.procedures[proc_id] = procedure
        self._persist(procedure)

        return proc_id

    def find_applicable_procedures(
        self,
        task_description: str,
        context: dict
    ) -> list[Procedure]:
        """Find procedures that might apply to this task."""
        applicable = []

        # Check trigger conditions
        for proc in self.procedures.values():
            if proc.matches_context(context):
                applicable.append(proc)

        # Also search by semantic similarity
        query_embedding = self.embeddings.embed_query(task_description)

        for proc in self.procedures.values():
            if proc in applicable:
                continue

            proc_embedding = self.embeddings.embed_query(
                f"{proc.name}: {proc.description}"
            )
            similarity = self._cosine_similarity(query_embedding, proc_embedding)

            if similarity > 0.7:
                applicable.append(proc)

        # Sort by success rate
        applicable.sort(key=lambda p: p.success_rate, reverse=True)

        return applicable

    def record_execution(
        self,
        procedure_id: str,
        success: bool,
        duration_seconds: float
    ):
        """Record procedure execution result."""
        proc = self.procedures.get(procedure_id)
        if not proc:
            return

        proc.execution_count += 1
        if success:
            proc.success_count += 1

        # Update average duration
        total_duration = proc.avg_duration_seconds * (proc.execution_count - 1)
        proc.avg_duration_seconds = (total_duration + duration_seconds) / proc.execution_count

        self._persist(proc)

    def get_best_procedure(self, task: str, context: dict) -> Optional[Procedure]:
        """Get the best procedure for a task."""
        applicable = self.find_applicable_procedures(task, context)

        if not applicable:
            return None

        # Prefer procedures with high success rate and many executions
        def score(proc: Procedure) -> float:
            confidence = min(proc.execution_count / 10, 1.0)  # Confidence grows with usage
            return proc.success_rate * confidence

        return max(applicable, key=score)

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        import numpy as np
        a, b = np.array(a), np.array(b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    def _persist(self, procedure: Procedure):
        data = {
            "id": procedure.id,
            "name": procedure.name,
            "description": procedure.description,
            "trigger_conditions": procedure.trigger_conditions,
            "steps": [
                {
                    "action": s.action,
                    "parameters": s.parameters,
                    "expected_output": s.expected_output,
                    "error_handling": s.error_handling,
                    "timeout_seconds": s.timeout_seconds
                }
                for s in procedure.steps
            ],
            "success_criteria": procedure.success_criteria,
            "parameters_schema": procedure.parameters_schema,
            "execution_count": procedure.execution_count,
            "success_count": procedure.success_count,
            "avg_duration_seconds": procedure.avg_duration_seconds
        }
        self.storage.save(f"procedure:{procedure.id}", data)
```

## Procedure Executor

```python
from typing import Any
import time

class ProcedureExecutor:
    def __init__(
        self,
        memory: ProceduralMemoryStore,
        action_handlers: dict[str, Callable]
    ):
        self.memory = memory
        self.action_handlers = action_handlers

    def execute(
        self,
        procedure: Procedure,
        parameters: dict
    ) -> tuple[bool, Any, list[dict]]:
        """
        Execute a procedure.
        Returns (success, result, step_results)
        """
        start_time = time.time()
        step_results = []
        final_result = None

        try:
            for i, step in enumerate(procedure.steps):
                # Resolve parameters
                step_params = self._resolve_parameters(
                    step.parameters,
                    parameters,
                    step_results
                )

                # Execute step
                try:
                    handler = self.action_handlers.get(step.action)
                    if not handler:
                        raise ValueError(f"Unknown action: {step.action}")

                    result = handler(**step_params)

                    step_results.append({
                        "step": i,
                        "action": step.action,
                        "success": True,
                        "result": result
                    })

                    final_result = result

                except Exception as e:
                    step_results.append({
                        "step": i,
                        "action": step.action,
                        "success": False,
                        "error": str(e)
                    })

                    # Handle error
                    if step.error_handling == "skip":
                        continue
                    elif step.error_handling == "retry":
                        # Simple retry
                        try:
                            result = handler(**step_params)
                            step_results[-1] = {
                                "step": i,
                                "action": step.action,
                                "success": True,
                                "result": result,
                                "retried": True
                            }
                        except:
                            raise
                    else:
                        raise

            success = True

        except Exception as e:
            success = False
            final_result = {"error": str(e)}

        # Record execution
        duration = time.time() - start_time
        self.memory.record_execution(procedure.id, success, duration)

        return success, final_result, step_results

    def _resolve_parameters(
        self,
        step_params: dict,
        input_params: dict,
        step_results: list[dict]
    ) -> dict:
        """Resolve parameter references."""
        resolved = {}

        for key, value in step_params.items():
            if isinstance(value, str):
                # Reference to input parameter: {{input.param_name}}
                if value.startswith("{{input.") and value.endswith("}}"):
                    param_name = value[8:-2]
                    resolved[key] = input_params.get(param_name)

                # Reference to previous step result: {{step.N.result}}
                elif value.startswith("{{step.") and value.endswith("}}"):
                    parts = value[7:-2].split(".")
                    step_num = int(parts[0])
                    if step_num < len(step_results):
                        resolved[key] = step_results[step_num].get("result")
                    else:
                        resolved[key] = None
                else:
                    resolved[key] = value
            else:
                resolved[key] = value

        return resolved
```

## Learning Procedures from Demonstrations

```python
from langchain_openai import AzureChatOpenAI

class ProcedureLearner:
    def __init__(self, memory: ProceduralMemoryStore):
        self.memory = memory
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")

    def learn_from_demonstration(
        self,
        task_name: str,
        actions_taken: list[dict]
    ) -> str:
        """Learn a procedure from demonstrated actions."""

        actions_text = "\n".join(
            f"{i+1}. {a['action']}: {json.dumps(a.get('parameters', {}))}"
            for i, a in enumerate(actions_taken)
        )

        prompt = f"""
Analyze this sequence of actions for the task "{task_name}":

{actions_text}

Create a reusable procedure:
1. Generalize specific values into parameters
2. Identify trigger conditions (when should this procedure be used?)
3. Define success criteria

Return JSON:
{{
  "name": "...",
  "description": "...",
  "trigger_conditions": ["..."],
  "steps": [
    {{
      "action": "...",
      "parameters": {{}},
      "expected_output": "...",
      "error_handling": "fail|skip|retry"
    }}
  ],
  "success_criteria": "...",
  "parameters_schema": {{
    "param_name": {{"type": "string", "description": "..."}}
  }}
}}
"""

        response = self.llm.invoke(prompt)

        try:
            procedure_def = json.loads(response.content)
        except:
            return None

        return self.memory.add_procedure(
            name=procedure_def["name"],
            description=procedure_def["description"],
            steps=procedure_def["steps"],
            trigger_conditions=procedure_def["trigger_conditions"],
            success_criteria=procedure_def["success_criteria"],
            parameters_schema=procedure_def.get("parameters_schema", {})
        )

    def improve_procedure(self, procedure_id: str, feedback: str) -> bool:
        """Improve procedure based on feedback."""
        proc = self.memory.procedures.get(procedure_id)
        if not proc:
            return False

        steps_text = "\n".join(
            f"{i+1}. {s.action}: {json.dumps(s.parameters)}"
            for i, s in enumerate(proc.steps)
        )

        prompt = f"""
Improve this procedure based on feedback:

Procedure: {proc.name}
Current steps:
{steps_text}

Feedback: {feedback}

Return improved steps as JSON array:
[{{"action": "...", "parameters": {{}}, "expected_output": "...", "error_handling": "..."}}]
"""

        response = self.llm.invoke(prompt)

        try:
            improved_steps = json.loads(response.content)
            proc.steps = [
                ProcedureStep(
                    action=s["action"],
                    parameters=s.get("parameters", {}),
                    expected_output=s.get("expected_output", ""),
                    error_handling=s.get("error_handling", "fail")
                )
                for s in improved_steps
            ]
            self.memory._persist(proc)
            return True
        except:
            return False
```

## Procedure-Guided Agent

```python
class ProcedureGuidedAgent:
    def __init__(
        self,
        memory: ProceduralMemoryStore,
        executor: ProcedureExecutor,
        learner: ProcedureLearner
    ):
        self.memory = memory
        self.executor = executor
        self.learner = learner
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")

    def handle_task(self, task: str, context: dict) -> dict:
        """Handle a task, using procedures when available."""

        # Look for applicable procedure
        procedure = self.memory.get_best_procedure(task, context)

        if procedure and procedure.success_rate > 0.7:
            # Use existing procedure
            return self._execute_with_procedure(procedure, task, context)
        else:
            # No good procedure - execute manually and learn
            return self._execute_and_learn(task, context)

    def _execute_with_procedure(
        self,
        procedure: Procedure,
        task: str,
        context: dict
    ) -> dict:
        """Execute task using known procedure."""

        # Extract parameters from task and context
        parameters = self._extract_parameters(procedure, task, context)

        # Execute
        success, result, steps = self.executor.execute(procedure, parameters)

        return {
            "method": "procedure",
            "procedure_name": procedure.name,
            "success": success,
            "result": result,
            "steps_executed": len(steps)
        }

    def _execute_and_learn(self, task: str, context: dict) -> dict:
        """Execute manually and learn procedure."""

        # Use LLM to plan and execute
        actions_taken = self._manual_execution(task, context)

        # Learn from the execution
        if actions_taken:
            proc_id = self.learner.learn_from_demonstration(task, actions_taken)

            return {
                "method": "manual_with_learning",
                "learned_procedure_id": proc_id,
                "actions_taken": len(actions_taken)
            }

        return {
            "method": "manual",
            "success": False
        }

    def _extract_parameters(
        self,
        procedure: Procedure,
        task: str,
        context: dict
    ) -> dict:
        """Extract procedure parameters from task and context."""
        prompt = f"""
Extract parameters for this procedure:

Procedure: {procedure.name}
Parameters needed: {json.dumps(procedure.parameters_schema)}

Task: {task}
Context: {json.dumps(context)}

Return JSON with parameter values:
"""

        response = self.llm.invoke(prompt)
        try:
            return json.loads(response.content)
        except:
            return {}

    def _manual_execution(self, task: str, context: dict) -> list[dict]:
        """Execute task manually (placeholder for actual execution)."""
        # This would integrate with actual tools
        return []
```

## Best Practices

1. **Define clear triggers**: Know when procedures apply
2. **Track success rates**: Only use reliable procedures
3. **Learn continuously**: Extract procedures from successful executions
4. **Handle errors gracefully**: Define error handling for each step
5. **Parameterize**: Make procedures reusable with parameters

## Conclusion

Procedural memory enables agents to remember how to do things, not just what things are. By learning and refining procedures, agents become more efficient over time.

Start by defining procedures for common tasks, track their performance, and let the agent learn from demonstrations to build its procedural knowledge.

