---
title: "Semantic Kernel Planners: Automatic AI Orchestration"
author: Michael John Peña
draft: false
date: 2023-02-18
tags:
  - Semantic Kernel
  - Azure
  - OpenAI
  - Planners
  - AI
---

## Types of Planners

```python
import semantic_kernel as sk
from semantic_kernel.planning import (
    SequentialPlanner,
    ActionPlanner,
    StepwisePlanner
)

# Sequential Planner - creates step-by-step plans
sequential = SequentialPlanner(kernel)

# Action Planner - selects single best action
action = ActionPlanner(kernel)

# Stepwise Planner - iteratively solves with reasoning
stepwise = StepwisePlanner(kernel)
```

## Sequential Planner

Creates multi-step plans:

```python
from semantic_kernel.planning import SequentialPlanner

async def use_sequential_planner(kernel: sk.Kernel, goal: str):
    """Create and execute a sequential plan."""

    planner = SequentialPlanner(kernel)

    # Create plan
    plan = await planner.create_plan_async(goal)

    # Inspect plan
    print(f"Plan for: {goal}")
    print(f"Steps: {len(plan._steps)}")
    for i, step in enumerate(plan._steps, 1):
        print(f"  {i}. {step.skill_name}.{step.name}")

    # Execute plan
    result = await plan.invoke_async()
    return str(result)

# Example
kernel = create_kernel_with_skills()

result = await use_sequential_planner(
    kernel,
    "Get customer data from database, analyze it, and create a summary report"
)
```

## Action Planner

Selects the single best action:

```python
from semantic_kernel.planning import ActionPlanner

async def use_action_planner(kernel: sk.Kernel, goal: str):
    """Use action planner for simple goals."""

    planner = ActionPlanner(kernel)

    # Create plan (single action)
    plan = await planner.create_plan_async(goal)

    print(f"Selected action: {plan.skill_name}.{plan.name}")
    print(f"Parameters: {plan.parameters}")

    # Execute
    result = await plan.invoke_async()
    return str(result)

# Good for:
# - Simple, direct requests
# - When you want quick responses
# - Reducing AI token usage
```

## Stepwise Planner

Iteratively reasons through complex problems:

```python
from semantic_kernel.planning import StepwisePlanner
from semantic_kernel.planning.stepwise_planner.stepwise_planner_config import StepwisePlannerConfig

async def use_stepwise_planner(kernel: sk.Kernel, goal: str):
    """Use stepwise planner for complex reasoning."""

    config = StepwisePlannerConfig(
        max_iterations=10,
        min_iteration_time_ms=0
    )

    planner = StepwisePlanner(kernel, config)

    # Create and execute plan
    plan = await planner.create_plan_async(goal)
    result = await plan.invoke_async()

    # Get reasoning trace
    print("Reasoning steps:")
    for step in plan.steps_taken:
        print(f"  - {step}")

    return str(result)

# Good for:
# - Complex multi-step problems
# - When intermediate reasoning matters
# - Research or analysis tasks
```

## Custom Planner Configuration

```python
from semantic_kernel.planning.sequential_planner.sequential_planner_config import SequentialPlannerConfig

# Configure sequential planner
config = SequentialPlannerConfig(
    relevancy_threshold=0.75,
    max_relevant_functions=20,
    included_skills=["DataAnalysis", "FileOperations"],
    excluded_skills=["DangerousOperations"],
    max_tokens=1024,
    allow_missing_functions=False
)

planner = SequentialPlanner(kernel, config)

# Configure action planner
from semantic_kernel.planning.action_planner.action_planner_config import ActionPlannerConfig

action_config = ActionPlannerConfig(
    included_skills=["QuickActions"],
    max_tokens=512
)
```

## Handling Plan Failures

```python
from semantic_kernel.planning.planning_exception import PlanningException

async def safe_plan_execution(kernel: sk.Kernel, goal: str) -> dict:
    """Execute plan with error handling."""

    planner = SequentialPlanner(kernel)

    try:
        # Create plan
        plan = await planner.create_plan_async(goal)

        if not plan._steps:
            return {
                "success": False,
                "error": "Could not create a plan for this goal",
                "suggestion": "Try rephrasing or breaking down the goal"
            }

        # Execute plan
        result = await plan.invoke_async()

        return {
            "success": True,
            "result": str(result),
            "steps_executed": len(plan._steps)
        }

    except PlanningException as e:
        return {
            "success": False,
            "error": f"Planning failed: {str(e)}",
            "suggestion": "Check if required skills are registered"
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"Execution failed: {str(e)}",
            "step_failed": "Unknown"
        }
```

## Plan Validation

```python
class PlanValidator:
    """Validate plans before execution."""

    def __init__(self, kernel: sk.Kernel):
        self.kernel = kernel

    def validate(self, plan) -> dict:
        """Validate a plan."""
        issues = []

        # Check if all skills exist
        for step in plan._steps:
            try:
                self.kernel.skills.get_function(step.skill_name, step.name)
            except:
                issues.append(f"Missing function: {step.skill_name}.{step.name}")

        # Check step count
        if len(plan._steps) > 10:
            issues.append(f"Plan has {len(plan._steps)} steps - consider simplifying")

        # Check for dangerous operations
        dangerous = ["delete", "drop", "remove", "destroy"]
        for step in plan._steps:
            if any(d in step.name.lower() for d in dangerous):
                issues.append(f"Potentially dangerous operation: {step.name}")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "step_count": len(plan._steps)
        }

# Usage
validator = PlanValidator(kernel)
plan = await planner.create_plan_async("Delete all old files")
validation = validator.validate(plan)

if not validation["valid"]:
    print("Plan issues:", validation["issues"])
```

## Planner Selection Guide

```python
def select_planner(goal: str, context: dict) -> str:
    """Select appropriate planner based on goal and context."""

    # Simple, direct goals -> Action Planner
    simple_keywords = ["what is", "tell me", "find", "get"]
    if any(kw in goal.lower() for kw in simple_keywords):
        if context.get("prefer_speed", False):
            return "action"

    # Complex analysis/research -> Stepwise Planner
    complex_keywords = ["analyze", "research", "investigate", "compare"]
    if any(kw in goal.lower() for kw in complex_keywords):
        return "stepwise"

    # Multi-step workflows -> Sequential Planner
    workflow_keywords = ["then", "after", "finally", "create report"]
    if any(kw in goal.lower() for kw in workflow_keywords):
        return "sequential"

    # Default to sequential
    return "sequential"

PLANNER_COMPARISON = {
    "action": {
        "best_for": "Simple, single-action goals",
        "speed": "Fast",
        "complexity": "Low",
        "tokens": "Low"
    },
    "sequential": {
        "best_for": "Multi-step workflows",
        "speed": "Medium",
        "complexity": "Medium",
        "tokens": "Medium"
    },
    "stepwise": {
        "best_for": "Complex reasoning tasks",
        "speed": "Slow",
        "complexity": "High",
        "tokens": "High"
    }
}
```

## Best Practices

1. **Register clear skill descriptions**: Planners rely on them
2. **Start with Action Planner**: For simple use cases
3. **Validate before executing**: Check plan makes sense
4. **Handle failures gracefully**: Plans can fail
5. **Monitor token usage**: Planners use tokens to plan
6. **Limit scope**: Use included_skills to constrain planning

## Resources

- [Semantic Kernel Planners](https://learn.microsoft.com/semantic-kernel/ai-orchestration/planners)
- [Planner Samples](https://github.com/microsoft/semantic-kernel/tree/main/samples/dotnet/kernel-syntax-examples)
