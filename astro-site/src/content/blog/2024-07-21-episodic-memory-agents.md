---
title: "Episodic Memory for AI Agents: Learning from Experiences"
author: Michael John Peña
draft: false
date: 2024-07-21
tags:
  - AI
  - Agents
  - Memory
  - Episodic Memory
  - Machine Learning

---

I wrote "Episodic Memory for AI Agents: Learning from Experiences" to share practical, production-minded guidance on this topic.

## What is Episodic Memory?

Unlike semantic memory (facts) or procedural memory (how-to), episodic memory captures:
- **Events**: What happened
- **Context**: When and where
- **Outcomes**: Results and consequences
- **Emotions**: Success/failure associations

## Episode Structure

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Any
from enum import Enum

class EpisodeOutcome(Enum):
    SUCCESS = "success"
    PARTIAL_SUCCESS = "partial_success"
    FAILURE = "failure"
    ABANDONED = "abandoned"

@dataclass
class Episode:
    id: str
    user_id: str
    task: str
    context: dict
    actions: list[dict]
    outcome: EpisodeOutcome
    outcome_details: str
    started_at: datetime
    completed_at: datetime
    duration_seconds: float
    metadata: dict = field(default_factory=dict)

    @property
    def summary(self) -> str:
        return f"{self.task} - {self.outcome.value} ({self.duration_seconds:.1f}s)"

@dataclass
class EpisodeAction:
    action_type: str
    input: Any
    output: Any
    timestamp: datetime
    success: bool
    error: Optional[str] = None
```

## Episodic Memory Store

```python
from langchain_openai import AzureOpenAIEmbeddings
import json
import uuid

class EpisodicMemoryStore:
    def __init__(self, storage_client, embeddings: AzureOpenAIEmbeddings):
        self.storage = storage_client
        self.embeddings = embeddings

    def start_episode(self, user_id: str, task: str, context: dict) -> str:
        """Start tracking a new episode."""
        episode_id = str(uuid.uuid4())

        episode = {
            "id": episode_id,
            "user_id": user_id,
            "task": task,
            "context": context,
            "actions": [],
            "outcome": None,
            "started_at": datetime.utcnow().isoformat(),
            "completed_at": None,
        }

        self.storage.save(f"episode:{episode_id}", episode)
        return episode_id

    def add_action(
        self,
        episode_id: str,
        action_type: str,
        input_data: Any,
        output_data: Any,
        success: bool,
        error: str = None
    ):
        """Add an action to the current episode."""
        episode = self.storage.get(f"episode:{episode_id}")
        if not episode:
            return

        action = {
            "action_type": action_type,
            "input": str(input_data)[:500],  # Truncate for storage
            "output": str(output_data)[:500],
            "timestamp": datetime.utcnow().isoformat(),
            "success": success,
            "error": error
        }

        episode["actions"].append(action)
        self.storage.save(f"episode:{episode_id}", episode)

    def complete_episode(
        self,
        episode_id: str,
        outcome: EpisodeOutcome,
        outcome_details: str = ""
    ) -> Episode:
        """Complete an episode with outcome."""
        episode = self.storage.get(f"episode:{episode_id}")
        if not episode:
            return None

        episode["outcome"] = outcome.value
        episode["outcome_details"] = outcome_details
        episode["completed_at"] = datetime.utcnow().isoformat()

        # Calculate duration
        started = datetime.fromisoformat(episode["started_at"])
        completed = datetime.fromisoformat(episode["completed_at"])
        episode["duration_seconds"] = (completed - started).total_seconds()

        # Generate embedding for similarity search
        episode_text = f"{episode['task']} - {json.dumps(episode['context'])}"
        episode["embedding"] = self.embeddings.embed_query(episode_text)

        # Save to permanent storage
        self.storage.save(f"episode:{episode_id}", episode)
        self.storage.add_to_index("episodes", episode_id, episode)

        return self._to_episode(episode)

    def recall_similar_episodes(
        self,
        user_id: str,
        task: str,
        context: dict,
        k: int = 5
    ) -> list[Episode]:
        """Find similar past episodes."""
        query_text = f"{task} - {json.dumps(context)}"
        query_embedding = self.embeddings.embed_query(query_text)

        similar = self.storage.vector_search(
            index="episodes",
            vector=query_embedding,
            filter={"user_id": user_id},
            k=k
        )

        return [self._to_episode(ep) for ep in similar]

    def get_success_rate(self, user_id: str, task_pattern: str = None) -> dict:
        """Get success rate for similar tasks."""
        episodes = self.storage.query(
            "episodes",
            filter={"user_id": user_id}
        )

        if task_pattern:
            episodes = [e for e in episodes if task_pattern.lower() in e["task"].lower()]

        if not episodes:
            return {"success_rate": None, "sample_size": 0}

        successes = sum(1 for e in episodes if e["outcome"] == "success")

        return {
            "success_rate": successes / len(episodes),
            "sample_size": len(episodes),
            "avg_duration": sum(e["duration_seconds"] for e in episodes) / len(episodes)
        }

    def _to_episode(self, data: dict) -> Episode:
        return Episode(
            id=data["id"],
            user_id=data["user_id"],
            task=data["task"],
            context=data["context"],
            actions=data["actions"],
            outcome=EpisodeOutcome(data["outcome"]) if data["outcome"] else None,
            outcome_details=data.get("outcome_details", ""),
            started_at=datetime.fromisoformat(data["started_at"]),
            completed_at=datetime.fromisoformat(data["completed_at"]) if data["completed_at"] else None,
            duration_seconds=data.get("duration_seconds", 0),
            metadata=data.get("metadata", {})
        )
```

## Episodic Learning Agent

```python
from langchain_openai import AzureChatOpenAI

class EpisodicLearningAgent:
    def __init__(self, memory: EpisodicMemoryStore):
        self.memory = memory
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")
        self.current_episode_id = None

    def execute_task(self, user_id: str, task: str, context: dict) -> dict:
        """Execute task with episodic learning."""

        # Start episode
        self.current_episode_id = self.memory.start_episode(user_id, task, context)

        # Recall similar episodes
        similar_episodes = self.memory.recall_similar_episodes(
            user_id, task, context, k=3
        )

        # Generate plan informed by past experiences
        plan = self._plan_with_experience(task, context, similar_episodes)

        # Execute plan
        try:
            result = self._execute_plan(plan)
            outcome = EpisodeOutcome.SUCCESS
            outcome_details = "Task completed successfully"
        except Exception as e:
            result = {"error": str(e)}
            outcome = EpisodeOutcome.FAILURE
            outcome_details = str(e)

        # Complete episode
        self.memory.complete_episode(
            self.current_episode_id,
            outcome,
            outcome_details
        )

        return result

    def _plan_with_experience(
        self,
        task: str,
        context: dict,
        similar_episodes: list[Episode]
    ) -> list[dict]:
        """Generate plan informed by past episodes."""

        experience_text = self._format_episodes(similar_episodes)

        prompt = f"""
Plan how to complete this task:
Task: {task}
Context: {json.dumps(context)}

Past experiences with similar tasks:
{experience_text}

Based on past successes and failures, create a step-by-step plan.
Learn from what worked and avoid what failed.

Return a JSON array of steps: [{{"action": "...", "details": "..."}}]
"""

        response = self.llm.invoke(prompt)

        try:
            return json.loads(response.content)
        except:
            return [{"action": "execute", "details": task}]

    def _format_episodes(self, episodes: list[Episode]) -> str:
        """Format episodes for prompt."""
        if not episodes:
            return "No similar past experiences found."

        formatted = []
        for ep in episodes:
            outcome_emoji = "SUCCESS" if ep.outcome == EpisodeOutcome.SUCCESS else "FAILED"

            actions_summary = ", ".join(
                a["action_type"] for a in ep.actions[:5]
            )

            formatted.append(f"""
- Task: {ep.task}
  Outcome: {outcome_emoji}
  Duration: {ep.duration_seconds:.0f}s
  Actions: {actions_summary}
  Details: {ep.outcome_details}
""")

        return "\n".join(formatted)

    def _execute_plan(self, plan: list[dict]) -> dict:
        """Execute the plan, recording actions."""
        results = []

        for step in plan:
            try:
                result = self._execute_step(step)
                self.memory.add_action(
                    self.current_episode_id,
                    action_type=step["action"],
                    input_data=step["details"],
                    output_data=result,
                    success=True
                )
                results.append(result)
            except Exception as e:
                self.memory.add_action(
                    self.current_episode_id,
                    action_type=step["action"],
                    input_data=step["details"],
                    output_data=None,
                    success=False,
                    error=str(e)
                )
                raise

        return {"results": results}

    def _execute_step(self, step: dict) -> Any:
        """Execute a single step."""
        # Implementation depends on available tools
        return f"Executed: {step['action']}"
```

## Episode Analysis and Learning

```python
class EpisodeAnalyzer:
    def __init__(self, memory: EpisodicMemoryStore):
        self.memory = memory
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")

    def analyze_failures(self, user_id: str, task_pattern: str = None) -> dict:
        """Analyze failure patterns."""
        episodes = self._get_episodes(user_id, task_pattern)
        failures = [e for e in episodes if e.outcome == EpisodeOutcome.FAILURE]

        if not failures:
            return {"message": "No failures found", "patterns": []}

        # Use LLM to identify patterns
        failures_text = "\n".join(
            f"- Task: {e.task}, Error: {e.outcome_details}, Actions: {[a['action_type'] for a in e.actions]}"
            for e in failures[:10]
        )

        prompt = f"""
Analyze these task failures and identify patterns:

{failures_text}

Return JSON:
{{
  "common_causes": ["..."],
  "recommendations": ["..."],
  "actions_to_avoid": ["..."]
}}
"""

        response = self.llm.invoke(prompt)
        try:
            analysis = json.loads(response.content)
        except:
            analysis = {"common_causes": [], "recommendations": [], "actions_to_avoid": []}

        return {
            "failure_count": len(failures),
            "total_episodes": len(episodes),
            "analysis": analysis
        }

    def extract_best_practices(self, user_id: str, task_pattern: str) -> list[str]:
        """Extract best practices from successful episodes."""
        episodes = self._get_episodes(user_id, task_pattern)
        successes = [
            e for e in episodes
            if e.outcome == EpisodeOutcome.SUCCESS
        ]

        if not successes:
            return []

        # Sort by duration (faster = better)
        successes.sort(key=lambda e: e.duration_seconds)

        # Analyze top performers
        top_episodes = successes[:5]

        episodes_text = "\n".join(
            f"- Task: {e.task}, Duration: {e.duration_seconds:.0f}s, Actions: {[a['action_type'] for a in e.actions]}"
            for e in top_episodes
        )

        prompt = f"""
Analyze these successful task completions and extract best practices:

{episodes_text}

What patterns lead to fast, successful completions?
Return a list of best practices.
"""

        response = self.llm.invoke(prompt)
        practices = response.content.strip().split("\n")
        return [p.strip("- ").strip() for p in practices if p.strip()]

    def _get_episodes(self, user_id: str, task_pattern: str = None) -> list[Episode]:
        """Get episodes matching criteria."""
        all_episodes = self.memory.storage.query(
            "episodes",
            filter={"user_id": user_id}
        )

        episodes = [self.memory._to_episode(e) for e in all_episodes]

        if task_pattern:
            episodes = [e for e in episodes if task_pattern.lower() in e.task.lower()]

        return episodes

    def suggest_approach(self, user_id: str, new_task: str, context: dict) -> dict:
        """Suggest approach based on episodic history."""
        similar = self.memory.recall_similar_episodes(user_id, new_task, context, k=5)

        if not similar:
            return {
                "confidence": "low",
                "suggestion": "No similar past experience. Proceeding with default approach.",
                "warnings": []
            }

        successes = [e for e in similar if e.outcome == EpisodeOutcome.SUCCESS]
        failures = [e for e in similar if e.outcome == EpisodeOutcome.FAILURE]

        confidence = "high" if len(successes) > len(failures) else "medium" if successes else "low"

        # Generate suggestion
        prompt = f"""
Based on past experience with similar tasks:

Successes ({len(successes)}):
{self._format_brief(successes)}

Failures ({len(failures)}):
{self._format_brief(failures)}

New task: {new_task}
Context: {json.dumps(context)}

Provide:
1. Recommended approach
2. Potential pitfalls to avoid
3. Expected duration
"""

        response = self.llm.invoke(prompt)

        return {
            "confidence": confidence,
            "success_history": len(successes),
            "failure_history": len(failures),
            "suggestion": response.content
        }

    def _format_brief(self, episodes: list[Episode]) -> str:
        return "\n".join(
            f"- {e.task}: {e.outcome_details[:100]}"
            for e in episodes[:3]
        ) or "None"
```

## Best Practices

1. **Record everything**: Actions, timing, outcomes
2. **Analyze regularly**: Extract patterns from episodes
3. **Use similarity search**: Find relevant past experiences
4. **Learn from failures**: Track what went wrong
5. **Surface insights**: Make learning available to users

## Conclusion

Episodic memory enables agents to truly learn from experience. By recording what happened and analyzing outcomes, agents improve over time and avoid repeating mistakes.

Start tracking episodes early, analyze them regularly, and use the insights to inform future task execution.

