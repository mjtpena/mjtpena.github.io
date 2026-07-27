---
title: "Agentic Workflows: Designing Autonomous AI Systems"
author: Michael John Peña
draft: false
date: 2025-06-05
tags:
  - AI
  - Agents
  - Workflows
  - Autonomous
  - Design

---

I wrote "Agentic Workflows: Designing Autonomous AI Systems" to share practical, production-minded guidance on this topic.

## Agentic Workflow Design

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class WorkflowState(Enum):
    PLANNING = "planning"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    COMPLETE = "complete"
    FAILED = "failed"
    PAUSED = "paused"

@dataclass
class WorkflowStep:
    name: str
    action: str
    inputs: Dict
    outputs: List[str]
    validation: Optional[Dict] = None
    human_review_required: bool = False

class AgenticWorkflow:
    def __init__(self, agent, max_iterations: int = 10):
        self.agent = agent
        self.max_iterations = max_iterations
        self.state = WorkflowState.PLANNING
        self.history: List[Dict] = []

    async def run(self, goal: str) -> Dict:
        """Run agentic workflow to achieve goal."""
        iteration = 0

        while iteration < self.max_iterations:
            iteration += 1

            if self.state == WorkflowState.PLANNING:
                plan = await self.plan(goal)
                if plan["ready"]:
                    self.state = WorkflowState.EXECUTING

            elif self.state == WorkflowState.EXECUTING:
                result = await self.execute_next_step()

                if result["needs_review"]:
                    self.state = WorkflowState.REVIEWING
                elif result["complete"]:
                    self.state = WorkflowState.COMPLETE
                elif result["failed"]:
                    self.state = WorkflowState.FAILED

            elif self.state == WorkflowState.REVIEWING:
                review = await self.review_progress()
                if review["continue"]:
                    self.state = WorkflowState.EXECUTING
                elif review["replan"]:
                    self.state = WorkflowState.PLANNING

            elif self.state in [WorkflowState.COMPLETE, WorkflowState.FAILED]:
                break

        return self.get_results()

    async def plan(self, goal: str) -> Dict:
        """Create execution plan."""
        plan = await self.agent.create_plan(goal, self.history)

        # Validate plan
        if not self.validate_plan(plan):
            return {"ready": False, "reason": "Invalid plan"}

        self.current_plan = plan
        return {"ready": True, "steps": len(plan["steps"])}

    async def execute_next_step(self) -> Dict:
        """Execute next step in plan."""
        step = self.get_next_step()
        if not step:
            return {"complete": True}

        # Check for human review
        if step.human_review_required:
            return {"needs_review": True, "step": step}

        # Execute step
        result = await self.agent.execute_step(step)

        # Validate result
        if step.validation:
            if not self.validate_result(result, step.validation):
                return {"failed": True, "reason": "Validation failed"}

        self.history.append({"step": step, "result": result})
        return {"success": True}

    def validate_plan(self, plan: Dict) -> bool:
        """Validate plan safety and feasibility."""
        # Check for dangerous actions
        dangerous = ["delete_all", "admin_action", "financial_transaction"]
        for step in plan.get("steps", []):
            if step["action"] in dangerous:
                return False
        return True
```

Safe agentic workflows balance autonomy with appropriate controls.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
