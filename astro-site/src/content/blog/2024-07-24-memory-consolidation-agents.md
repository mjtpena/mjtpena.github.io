---
title: "Memory Consolidation for AI Agents: From Short-Term to Long-Term"
author: Michael John Peña
draft: false
date: 2024-07-24
tags:
  - AI
  - Agents
  - Memory
  - Consolidation
  - Architecture
---

## The Consolidation Pipeline

```
Short-Term Memory
       │
       ▼
┌─────────────────┐
│   Importance    │
│   Filtering     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Abstraction   │
│   & Synthesis   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Categorization │
│   & Indexing    │
└────────┬────────┘
         │
         ▼
Long-Term Memory
```

## Importance Scoring

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from langchain_openai import AzureChatOpenAI
import json

@dataclass
class MemoryCandidate:
    content: str
    context: dict
    timestamp: datetime
    source: str  # "user", "system", "interaction"

@dataclass
class ScoredMemory:
    candidate: MemoryCandidate
    importance_score: float
    novelty_score: float
    utility_score: float
    combined_score: float
    reasoning: str

class ImportanceScorer:
    def __init__(self, existing_memories: list[str]):
        self.existing_memories = existing_memories
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o-mini")

    def score(self, candidate: MemoryCandidate) -> ScoredMemory:
        """Score a memory candidate for consolidation."""

        # Importance: How significant is this information?
        importance = self._score_importance(candidate)

        # Novelty: Is this new information or already known?
        novelty = self._score_novelty(candidate)

        # Utility: How useful will this be in the future?
        utility = self._score_utility(candidate)

        # Combined score with weights
        combined = (
            importance * 0.4 +
            novelty * 0.35 +
            utility * 0.25
        )

        return ScoredMemory(
            candidate=candidate,
            importance_score=importance,
            novelty_score=novelty,
            utility_score=utility,
            combined_score=combined,
            reasoning=f"Importance: {importance:.2f}, Novelty: {novelty:.2f}, Utility: {utility:.2f}"
        )

    def _score_importance(self, candidate: MemoryCandidate) -> float:
        """Score based on content importance."""
        prompt = f"""
Rate the importance of this information from 0 to 1:

"{candidate.content}"

Consider:
- Is it a fact, preference, or instruction?
- Does it affect future interactions?
- Is it time-sensitive or persistent?

Return only a number between 0 and 1.
"""
        response = self.llm.invoke(prompt)
        try:
            return float(response.content.strip())
        except:
            return 0.5

    def _score_novelty(self, candidate: MemoryCandidate) -> float:
        """Score based on whether this is new information."""
        if not self.existing_memories:
            return 1.0

        # Check similarity to existing memories
        existing_text = "\n".join(self.existing_memories[:20])

        prompt = f"""
Is this new information or already covered by existing knowledge?

New content: "{candidate.content}"

Existing knowledge:
{existing_text}

Rate novelty from 0 (completely redundant) to 1 (completely new).
Return only a number.
"""
        response = self.llm.invoke(prompt)
        try:
            return float(response.content.strip())
        except:
            return 0.5

    def _score_utility(self, candidate: MemoryCandidate) -> float:
        """Score based on future usefulness."""
        prompt = f"""
How useful will this information be for future interactions?

"{candidate.content}"

Consider:
- Will it help answer future questions?
- Does it provide context for understanding the user?
- Is it actionable?

Rate utility from 0 (not useful) to 1 (very useful).
Return only a number.
"""
        response = self.llm.invoke(prompt)
        try:
            return float(response.content.strip())
        except:
            return 0.5
```

## Memory Abstraction

```python
class MemoryAbstractor:
    def __init__(self):
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")

    def abstract_episode(self, episode_memories: list[dict]) -> dict:
        """Abstract an episode into key takeaways."""
        memories_text = "\n".join(
            f"- {m['content']}"
            for m in episode_memories
        )

        prompt = f"""
Analyze these memories from a conversation and extract:
1. Key facts learned
2. User preferences discovered
3. Decisions made
4. Procedures used

Memories:
{memories_text}

Return JSON:
{{
  "facts": ["..."],
  "preferences": ["..."],
  "decisions": [{{"decision": "...", "context": "..."}}],
  "procedures": ["..."],
  "summary": "..."
}}
"""
        response = self.llm.invoke(prompt)
        try:
            return json.loads(response.content)
        except:
            return {"summary": "Could not abstract memories", "facts": [], "preferences": [], "decisions": [], "procedures": []}

    def merge_similar_memories(self, memories: list[str]) -> list[str]:
        """Merge similar memories into consolidated versions."""
        if len(memories) <= 1:
            return memories

        prompt = f"""
Consolidate these similar memories, removing redundancy while preserving all information:

{chr(10).join(f'- {m}' for m in memories)}

Return consolidated memories as a JSON array of strings.
"""
        response = self.llm.invoke(prompt)
        try:
            return json.loads(response.content)
        except:
            return memories

    def generalize_pattern(self, specific_instances: list[str]) -> Optional[str]:
        """Generalize specific instances into a pattern."""
        if len(specific_instances) < 3:
            return None

        prompt = f"""
Find the general pattern in these specific instances:

{chr(10).join(f'- {s}' for s in specific_instances)}

If there's a clear pattern, describe it as a general rule.
If no pattern exists, return "NO_PATTERN".
"""
        response = self.llm.invoke(prompt)
        content = response.content.strip()

        if content == "NO_PATTERN":
            return None
        return content
```

## Consolidation Engine

```python
from typing import Callable

class MemoryConsolidator:
    def __init__(
        self,
        short_term_memory,
        long_term_memory,
        importance_threshold: float = 0.6
    ):
        self.short_term = short_term_memory
        self.long_term = long_term_memory
        self.importance_threshold = importance_threshold
        self.scorer = ImportanceScorer(
            existing_memories=self._get_existing_memories()
        )
        self.abstractor = MemoryAbstractor()

    def _get_existing_memories(self) -> list[str]:
        """Get existing long-term memories for novelty comparison."""
        # Implementation depends on long-term memory store
        return []

    def consolidate_session(self, user_id: str, session_memories: list[dict]):
        """Consolidate a session's memories into long-term storage."""

        # Step 1: Score all memories
        scored = []
        for memory in session_memories:
            candidate = MemoryCandidate(
                content=memory["content"],
                context=memory.get("context", {}),
                timestamp=datetime.fromisoformat(memory.get("timestamp", datetime.utcnow().isoformat())),
                source=memory.get("source", "interaction")
            )
            scored.append(self.scorer.score(candidate))

        # Step 2: Filter by importance
        important = [s for s in scored if s.combined_score >= self.importance_threshold]

        if not important:
            return {"consolidated": 0, "discarded": len(scored)}

        # Step 3: Abstract and categorize
        abstraction = self.abstractor.abstract_episode(
            [{"content": s.candidate.content} for s in important]
        )

        # Step 4: Store in long-term memory
        stored_count = 0

        # Store facts
        for fact in abstraction.get("facts", []):
            self.long_term.store(
                user_id=user_id,
                content=fact,
                memory_type="fact"
            )
            stored_count += 1

        # Store preferences
        for pref in abstraction.get("preferences", []):
            self.long_term.store(
                user_id=user_id,
                content=pref,
                memory_type="preference"
            )
            stored_count += 1

        # Store decisions
        for decision in abstraction.get("decisions", []):
            self.long_term.store(
                user_id=user_id,
                content=f"Decision: {decision['decision']}. Context: {decision.get('context', '')}",
                memory_type="decision"
            )
            stored_count += 1

        return {
            "consolidated": stored_count,
            "discarded": len(scored) - len(important),
            "abstraction_summary": abstraction.get("summary", "")
        }

    def periodic_consolidation(self, user_id: str):
        """Run periodic consolidation to merge and clean memories."""

        # Get all user's long-term memories
        all_memories = self.long_term.recall(user_id, query="*", k=1000)

        # Group by type
        by_type = {}
        for memory in all_memories:
            mtype = memory.get("type", "unknown")
            if mtype not in by_type:
                by_type[mtype] = []
            by_type[mtype].append(memory)

        # Merge similar memories within each type
        for mtype, memories in by_type.items():
            if len(memories) > 10:
                contents = [m["content"] for m in memories]
                merged = self.abstractor.merge_similar_memories(contents)

                if len(merged) < len(memories):
                    # Delete old memories and store merged
                    for memory in memories:
                        self.long_term.forget(memory["id"])

                    for content in merged:
                        self.long_term.store(
                            user_id=user_id,
                            content=content,
                            memory_type=mtype,
                            metadata={"consolidated": True}
                        )

        # Look for patterns to generalize
        self._generalize_patterns(user_id, by_type)

    def _generalize_patterns(self, user_id: str, memories_by_type: dict):
        """Find and store general patterns from specific memories."""

        # Look for patterns in decisions
        decisions = memories_by_type.get("decision", [])
        if len(decisions) >= 5:
            contents = [d["content"] for d in decisions]
            pattern = self.abstractor.generalize_pattern(contents)

            if pattern:
                self.long_term.store(
                    user_id=user_id,
                    content=f"Pattern: {pattern}",
                    memory_type="pattern"
                )
```

## Scheduled Consolidation

```python
from datetime import datetime, timedelta
import asyncio

class ConsolidationScheduler:
    def __init__(self, consolidator: MemoryConsolidator):
        self.consolidator = consolidator
        self.last_consolidation: dict[str, datetime] = {}
        self.session_interval = timedelta(hours=1)
        self.periodic_interval = timedelta(days=1)

    async def run_scheduler(self):
        """Run consolidation on schedule."""
        while True:
            await asyncio.sleep(3600)  # Check every hour
            await self._check_and_consolidate()

    async def _check_and_consolidate(self):
        """Check which users need consolidation."""
        users_with_sessions = self._get_users_with_recent_sessions()

        for user_id in users_with_sessions:
            last = self.last_consolidation.get(user_id)

            if not last or datetime.utcnow() - last > self.session_interval:
                # Run session consolidation
                session_memories = self._get_session_memories(user_id)
                if session_memories:
                    self.consolidator.consolidate_session(user_id, session_memories)
                    self.last_consolidation[user_id] = datetime.utcnow()

            if not last or datetime.utcnow() - last > self.periodic_interval:
                # Run periodic consolidation
                self.consolidator.periodic_consolidation(user_id)

    def _get_users_with_recent_sessions(self) -> list[str]:
        """Get users who have had recent activity."""
        # Implementation depends on session tracking
        return []

    def _get_session_memories(self, user_id: str) -> list[dict]:
        """Get memories from recent sessions."""
        # Implementation depends on short-term memory store
        return []

    def trigger_immediate_consolidation(self, user_id: str):
        """Trigger consolidation immediately for a user."""
        session_memories = self._get_session_memories(user_id)
        if session_memories:
            return self.consolidator.consolidate_session(user_id, session_memories)
        return {"consolidated": 0, "message": "No memories to consolidate"}
```

## Integration with Agent

```python
class ConsolidatingAgent:
    def __init__(
        self,
        short_term,
        long_term,
        consolidator: MemoryConsolidator
    ):
        self.short_term = short_term
        self.long_term = long_term
        self.consolidator = consolidator
        self.session_memories = []

    def add_interaction(self, user_id: str, role: str, content: str):
        """Record an interaction."""
        memory = {
            "content": content,
            "source": role,
            "timestamp": datetime.utcnow().isoformat(),
            "context": {"user_id": user_id}
        }

        self.short_term.add({"role": role, "content": content})
        self.session_memories.append(memory)

    def end_session(self, user_id: str):
        """End session and trigger consolidation."""
        if self.session_memories:
            result = self.consolidator.consolidate_session(
                user_id,
                self.session_memories
            )
            self.session_memories = []
            return result
        return {"consolidated": 0}
```

## Best Practices

1. **Set appropriate thresholds**: Not everything needs to be remembered
2. **Consolidate regularly**: Don't let short-term memory overflow
3. **Abstract intelligently**: Extract patterns, not just facts
4. **Merge redundancy**: Keep memory clean and efficient
5. **Track consolidation metrics**: Know what's being kept and discarded

## Conclusion

Memory consolidation is the bridge between fleeting interactions and lasting knowledge. Without it, agents either forget or drown in detail.

Implement importance scoring, regular consolidation, and pattern extraction to build agents with effective long-term memory that improves over time.
