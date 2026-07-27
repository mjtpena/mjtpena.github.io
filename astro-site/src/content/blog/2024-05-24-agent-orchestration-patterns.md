---
title: "Agent Orchestration Patterns for Production"
author: Michael John Peña
draft: false
date: 2024-05-24
tags:
  - AI Agents
  - Orchestration
  - Architecture
  - Azure AI
  - Patterns
---

Building single agents is one thing. Orchestrating multiple agents for complex workflows is another. Today I'm exploring production-ready orchestration patterns.

## Orchestration Patterns Overview

```
1. Sequential Pipeline
   A → B → C → Result

2. Parallel Fan-Out
   A → [B, C, D] → E

3. Router/Dispatcher
   Input → Router → Specialist → Result

4. Supervisor/Worker
   Supervisor ↔ [Worker1, Worker2, Worker3]

5. Hierarchical
   Director → Managers → Workers
```

## Pattern 1: Sequential Pipeline

```python
from dataclasses import dataclass
from typing import Any, Callable
import asyncio

@dataclass
class PipelineStage:
    name: str
    agent: Any
    transform: Callable = None

class SequentialPipeline:
    """Execute agents in sequence, passing output to next stage."""

    def __init__(self, stages: list[PipelineStage]):
        self.stages = stages

    async def execute(self, initial_input: Any) -> dict:
        current_input = initial_input
        results = {"input": initial_input, "stages": []}

        for stage in self.stages:
            start_time = time.time()

            # Execute stage
            output = await stage.agent.run(current_input)

            # Transform output if needed
            if stage.transform:
                output = stage.transform(output)

            results["stages"].append({
                "name": stage.name,
                "input": current_input,
                "output": output,
                "duration": time.time() - start_time
            })

            current_input = output

        results["final_output"] = current_input
        return results

# Usage
pipeline = SequentialPipeline([
    PipelineStage("research", ResearchAgent()),
    PipelineStage("analyze", AnalysisAgent()),
    PipelineStage("summarize", SummaryAgent())
])

result = await pipeline.execute("What are the latest AI trends?")
```

## Pattern 2: Parallel Fan-Out

```python
class ParallelFanOut:
    """Execute multiple agents in parallel, aggregate results."""

    def __init__(self, agents: list, aggregator: Any):
        self.agents = agents
        self.aggregator = aggregator

    async def execute(self, input_data: Any) -> Any:
        # Fan out to all agents
        tasks = [agent.run(input_data) for agent in self.agents]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle failures
        successful_results = []
        failures = []
        for agent, result in zip(self.agents, results):
            if isinstance(result, Exception):
                failures.append({"agent": agent.name, "error": str(result)})
            else:
                successful_results.append({"agent": agent.name, "result": result})

        # Aggregate results
        aggregated = await self.aggregator.aggregate(successful_results)

        return {
            "aggregated_result": aggregated,
            "individual_results": successful_results,
            "failures": failures
        }

# Usage: Multi-perspective analysis
fan_out = ParallelFanOut(
    agents=[
        TechnicalAnalyst(),
        BusinessAnalyst(),
        RiskAnalyst()
    ],
    aggregator=PerspectiveAggregator()
)

result = await fan_out.execute("Should we adopt this new technology?")
```

## Pattern 3: Router/Dispatcher

```python
class RouterDispatcher:
    """Route requests to specialized agents based on intent."""

    def __init__(self, client, specialists: dict):
        self.client = client
        self.specialists = specialists

    async def route(self, user_input: str) -> Any:
        # Determine intent
        intent = await self._classify_intent(user_input)

        # Find specialist
        specialist = self.specialists.get(intent["category"])
        if not specialist:
            specialist = self.specialists.get("default")

        # Execute specialist
        return await specialist.run(user_input, intent)

    async def _classify_intent(self, text: str) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""Classify this request. Categories: {list(self.specialists.keys())}
Return JSON: {{"category": "...", "confidence": 0.95, "entities": {{}}}}"""
                },
                {"role": "user", "content": text}
            ],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

# Usage
router = RouterDispatcher(
    client=openai_client,
    specialists={
        "technical": TechnicalSupportAgent(),
        "billing": BillingAgent(),
        "sales": SalesAgent(),
        "default": GeneralAgent()
    }
)

result = await router.route("How do I reset my password?")
```

## Pattern 4: Supervisor/Worker

```python
class SupervisorWorkerOrchestrator:
    """Supervisor coordinates workers, reviews results, retries if needed."""

    def __init__(self, supervisor: Any, workers: list):
        self.supervisor = supervisor
        self.workers = {w.name: w for w in workers}
        self.max_retries = 3

    async def execute(self, task: str) -> dict:
        # Supervisor creates work plan
        plan = await self.supervisor.plan(task, list(self.workers.keys()))

        results = {}
        for assignment in plan["assignments"]:
            worker = self.workers[assignment["worker"]]
            subtask = assignment["task"]

            # Execute with supervision
            result = await self._supervised_execution(
                worker, subtask, assignment.get("criteria", {})
            )
            results[assignment["id"]] = result

        # Supervisor synthesizes final result
        return await self.supervisor.synthesize(task, results)

    async def _supervised_execution(
        self,
        worker: Any,
        task: str,
        criteria: dict
    ) -> dict:
        for attempt in range(self.max_retries):
            result = await worker.run(task)

            # Supervisor reviews
            review = await self.supervisor.review(result, criteria)

            if review["approved"]:
                return {
                    "result": result,
                    "attempts": attempt + 1,
                    "review": review
                }

            # Provide feedback for retry
            task = f"{task}\n\nFeedback from review: {review['feedback']}"

        return {
            "result": result,
            "attempts": self.max_retries,
            "review": {"approved": False, "note": "Max retries exceeded"}
        }

# Usage
orchestrator = SupervisorWorkerOrchestrator(
    supervisor=QualitySupervisor(),
    workers=[
        ResearchWorker(name="researcher"),
        WriterWorker(name="writer"),
        FactCheckerWorker(name="fact_checker")
    ]
)

result = await orchestrator.execute("Write an article about quantum computing")
```

## Pattern 5: Hierarchical Organization

```python
class HierarchicalOrganization:
    """Multi-level agent hierarchy mimicking organizational structure."""

    def __init__(self):
        self.director = DirectorAgent()
        self.managers = {
            "engineering": EngineeringManager(),
            "research": ResearchManager(),
            "content": ContentManager()
        }
        self.workers = {
            "engineering": [CodeAgent(), TestAgent(), DeployAgent()],
            "research": [SearchAgent(), AnalysisAgent()],
            "content": [WriterAgent(), EditorAgent()]
        }

    async def execute_project(self, project_brief: str) -> dict:
        # Director creates high-level plan
        strategic_plan = await self.director.create_strategic_plan(project_brief)

        # Managers create tactical plans
        tactical_plans = {}
        for department, objectives in strategic_plan["departments"].items():
            manager = self.managers[department]
            tactical_plans[department] = await manager.create_tactical_plan(objectives)

        # Workers execute tasks
        results = {}
        for department, plan in tactical_plans.items():
            department_results = []
            for task in plan["tasks"]:
                worker = self._select_worker(department, task)
                result = await worker.execute(task)
                department_results.append(result)

            # Manager reviews department output
            manager = self.managers[department]
            reviewed = await manager.review_and_integrate(department_results)
            results[department] = reviewed

        # Director creates final deliverable
        return await self.director.create_final_deliverable(results)

    def _select_worker(self, department: str, task: dict) -> Any:
        workers = self.workers[department]
        # Match worker to task type
        for worker in workers:
            if worker.can_handle(task["type"]):
                return worker
        return workers[0]  # Default to first worker
```

## State Management

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
import uuid

class TaskStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class TaskState:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: TaskStatus = TaskStatus.PENDING
    input: Any = None
    output: Optional[Any] = None
    error: Optional[str] = None
    agent: Optional[str] = None
    parent_id: Optional[str] = None
    children: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

class OrchestrationState:
    """Manage state across orchestration workflow."""

    def __init__(self, persistence_backend=None):
        self.tasks: dict[str, TaskState] = {}
        self.persistence = persistence_backend

    def create_task(self, input_data: Any, parent_id: str = None) -> TaskState:
        task = TaskState(input=input_data, parent_id=parent_id)
        self.tasks[task.id] = task

        if parent_id and parent_id in self.tasks:
            self.tasks[parent_id].children.append(task.id)

        self._persist(task)
        return task

    def update_task(self, task_id: str, **updates):
        task = self.tasks.get(task_id)
        if task:
            for key, value in updates.items():
                setattr(task, key, value)
            self._persist(task)

    def get_workflow_status(self) -> dict:
        status_counts = {}
        for task in self.tasks.values():
            status_counts[task.status.value] = status_counts.get(task.status.value, 0) + 1

        return {
            "total_tasks": len(self.tasks),
            "status_breakdown": status_counts,
            "completion_rate": status_counts.get("completed", 0) / len(self.tasks) if self.tasks else 0
        }

    def _persist(self, task: TaskState):
        if self.persistence:
            self.persistence.save(task)
```

## Error Recovery

```python
class ResilientOrchestrator:
    """Orchestrator with error recovery and retry logic."""

    def __init__(self, agents: dict, max_retries: int = 3):
        self.agents = agents
        self.max_retries = max_retries
        self.state = OrchestrationState()

    async def execute_with_recovery(self, task: str) -> dict:
        root_task = self.state.create_task(task)

        try:
            result = await self._execute_task(root_task.id)
            self.state.update_task(root_task.id, status=TaskStatus.COMPLETED, output=result)
            return result
        except Exception as e:
            # Attempt recovery
            recovery_result = await self._attempt_recovery(root_task.id, e)
            return recovery_result

    async def _execute_task(self, task_id: str) -> Any:
        task = self.state.tasks[task_id]
        self.state.update_task(task_id, status=TaskStatus.IN_PROGRESS)

        for attempt in range(self.max_retries):
            try:
                agent = self._select_agent(task)
                result = await agent.run(task.input)
                return result
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise
                await asyncio.sleep(2 ** attempt)  # Exponential backoff

    async def _attempt_recovery(self, task_id: str, error: Exception) -> dict:
        task = self.state.tasks[task_id]

        # Try alternative agent
        alternative = self._get_alternative_agent(task, error)
        if alternative:
            try:
                result = await alternative.run(task.input)
                self.state.update_task(
                    task_id,
                    status=TaskStatus.COMPLETED,
                    output=result,
                    metadata={"recovered": True, "original_error": str(error)}
                )
                return result
            except:
                pass

        # Mark as failed
        self.state.update_task(
            task_id,
            status=TaskStatus.FAILED,
            error=str(error)
        )
        raise error
```

## Monitoring and Observability

```python
from opentelemetry import trace, metrics

tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)

# Metrics
task_counter = meter.create_counter("orchestration.tasks.total")
task_duration = meter.create_histogram("orchestration.tasks.duration")
active_tasks = meter.create_up_down_counter("orchestration.tasks.active")

class InstrumentedOrchestrator:
    """Orchestrator with full observability."""

    def __init__(self, base_orchestrator):
        self.orchestrator = base_orchestrator

    async def execute(self, task: str) -> dict:
        with tracer.start_as_current_span("orchestration.execute") as span:
            span.set_attribute("task.input", task[:100])
            active_tasks.add(1)

            start_time = time.time()
            try:
                result = await self.orchestrator.execute(task)
                span.set_attribute("task.status", "success")
                task_counter.add(1, {"status": "success"})
                return result
            except Exception as e:
                span.set_attribute("task.status", "error")
                span.record_exception(e)
                task_counter.add(1, {"status": "error"})
                raise
            finally:
                duration = time.time() - start_time
                task_duration.record(duration)
                active_tasks.add(-1)
```

## Best Practices

1. **Clear contracts** - Define input/output schemas between agents
2. **Idempotency** - Tasks should be safe to retry
3. **Timeouts** - Always set timeouts on agent calls
4. **Graceful degradation** - Handle partial failures
5. **Observability** - Log and trace everything

## What's Next

Tomorrow I'll cover tool use patterns for AI agents.

## Resources

- [LangGraph](https://python.langchain.com/docs/langgraph)
- [CrewAI](https://github.com/joaomdmoura/crewAI)
- [AutoGen](https://github.com/microsoft/autogen)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
