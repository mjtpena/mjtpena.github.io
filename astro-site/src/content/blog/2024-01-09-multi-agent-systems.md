---
title: "Multi-Agent Systems: Orchestrating Specialized AI Agents"
author: Michael John Peña
draft: false
date: 2024-01-09
tags:
  - AI Agents
  - Multi-Agent
  - Azure OpenAI
  - Architecture
  - Enterprise AI
---

Complex enterprise tasks benefit from specialization. In my work, coordinating small specialist agents led to clearer reasoning, easier testing, and more predictable cost profiles than monolithic agents. These are the architecture patterns I rely on.

## Why Multi-Agent?

Consider a complex enterprise task: "Analyze our Q4 sales data, identify underperforming regions, draft an email to regional managers with improvement suggestions, and schedule follow-up meetings."

A single agent would need to:
- Query databases (data analyst skills)
- Perform statistical analysis
- Write professional emails (communication skills)
- Access calendar systems (tool integration)

Multi-agent systems let us create specialized agents for each capability.

## Architecture Patterns

### Pattern 1: Hierarchical Orchestration

A supervisor agent coordinates specialized workers:

```python
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Callable
import asyncio

class AgentRole(Enum):
    SUPERVISOR = "supervisor"
    DATA_ANALYST = "data_analyst"
    WRITER = "writer"
    RESEARCHER = "researcher"
    CODER = "coder"

@dataclass
class AgentMessage:
    from_agent: str
    to_agent: str
    content: str
    task_id: str
    requires_response: bool = True

@dataclass
class TaskResult:
    agent: str
    task_id: str
    success: bool
    result: str
    error: Optional[str] = None

class BaseAgent:
    def __init__(self, name: str, role: AgentRole, llm_client, tools: list = None):
        self.name = name
        self.role = role
        self.llm = llm_client
        self.tools = tools or []
        self.system_prompt = self._build_system_prompt()

    def _build_system_prompt(self) -> str:
        """Build role-specific system prompt."""
        raise NotImplementedError

    async def process(self, message: AgentMessage) -> TaskResult:
        """Process an incoming message/task."""
        raise NotImplementedError

class SupervisorAgent(BaseAgent):
    def __init__(self, llm_client, worker_agents: dict[str, BaseAgent]):
        super().__init__("Supervisor", AgentRole.SUPERVISOR, llm_client)
        self.workers = worker_agents
        self.task_history = []

    def _build_system_prompt(self) -> str:
        worker_descriptions = "\n".join([
            f"- {name}: {agent.role.value}"
            for name, agent in self.workers.items()
        ])

        return f"""You are a supervisor agent coordinating a team of specialized agents.

Your team:
{worker_descriptions}

Your job:
1. Analyze incoming tasks
2. Break them into subtasks
3. Delegate to appropriate agents
4. Synthesize results
5. Ensure quality

Always think step by step about which agent should handle each part."""

    async def process(self, task: str) -> str:
        """Process a complex task by orchestrating workers."""

        # Step 1: Plan the task decomposition
        plan = await self._create_plan(task)

        # Step 2: Execute plan steps
        results = []
        for step in plan["steps"]:
            agent_name = step["agent"]
            subtask = step["task"]

            if agent_name not in self.workers:
                results.append(TaskResult(
                    agent=agent_name,
                    task_id=step["id"],
                    success=False,
                    result="",
                    error=f"Unknown agent: {agent_name}"
                ))
                continue

            message = AgentMessage(
                from_agent=self.name,
                to_agent=agent_name,
                content=subtask,
                task_id=step["id"]
            )

            result = await self.workers[agent_name].process(message)
            results.append(result)

            # Check for failure
            if not result.success and step.get("critical", False):
                break

        # Step 3: Synthesize final response
        return await self._synthesize_results(task, results)

    async def _create_plan(self, task: str) -> dict:
        """Create execution plan for the task."""

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": self.system_prompt},
                {
                    "role": "user",
                    "content": f"""Create an execution plan for this task:
                    {task}

                    Return JSON:
                    {{
                        "steps": [
                            {{"id": "1", "agent": "agent_name", "task": "specific subtask", "critical": true/false}},
                            ...
                        ]
                    }}"""
                }
            ]
        )

        return json.loads(response.choices[0].message.content)

    async def _synthesize_results(self, original_task: str, results: list[TaskResult]) -> str:
        """Synthesize worker results into final response."""

        results_text = "\n\n".join([
            f"Agent: {r.agent}\nTask ID: {r.task_id}\nSuccess: {r.success}\nResult: {r.result}"
            for r in results
        ])

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "Synthesize the agent results into a coherent final response."
                },
                {
                    "role": "user",
                    "content": f"""Original task: {original_task}

Agent results:
{results_text}

Provide a comprehensive response addressing the original task."""
                }
            ]
        )

        return response.choices[0].message.content

class DataAnalystAgent(BaseAgent):
    def __init__(self, llm_client, database_client):
        super().__init__("DataAnalyst", AgentRole.DATA_ANALYST, llm_client)
        self.db = database_client

    def _build_system_prompt(self) -> str:
        return """You are a data analyst agent. You can:
        - Write and execute SQL queries
        - Perform statistical analysis
        - Identify trends and anomalies
        - Create data summaries

        Always validate your queries before execution.
        Present findings with supporting numbers."""

    async def process(self, message: AgentMessage) -> TaskResult:
        """Process a data analysis task."""

        try:
            # Generate analysis plan
            analysis = await self._plan_analysis(message.content)

            # Execute queries
            query_results = []
            for query in analysis.get("queries", []):
                result = await self.db.execute(query)
                query_results.append(result)

            # Generate insights
            insights = await self._generate_insights(message.content, query_results)

            return TaskResult(
                agent=self.name,
                task_id=message.task_id,
                success=True,
                result=insights
            )

        except Exception as e:
            return TaskResult(
                agent=self.name,
                task_id=message.task_id,
                success=False,
                result="",
                error=str(e)
            )

    async def _plan_analysis(self, task: str) -> dict:
        """Plan the analysis approach."""
        # Implementation details...
        pass

    async def _generate_insights(self, task: str, data: list) -> str:
        """Generate insights from query results."""
        # Implementation details...
        pass

class WriterAgent(BaseAgent):
    def __init__(self, llm_client, style_guide: str = None):
        super().__init__("Writer", AgentRole.WRITER, llm_client)
        self.style_guide = style_guide

    def _build_system_prompt(self) -> str:
        base = """You are a professional writer agent. You can:
        - Draft emails and communications
        - Create reports and summaries
        - Adapt tone for different audiences
        - Edit and improve text"""

        if self.style_guide:
            base += f"\n\nStyle Guide:\n{self.style_guide}"

        return base

    async def process(self, message: AgentMessage) -> TaskResult:
        """Process a writing task."""

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": message.content}
            ]
        )

        return TaskResult(
            agent=self.name,
            task_id=message.task_id,
            success=True,
            result=response.choices[0].message.content
        )
```

### Pattern 2: Peer-to-Peer Collaboration

Agents communicate directly without a central supervisor:

```python
class CollaborativeAgent(BaseAgent):
    def __init__(self, name: str, role: AgentRole, llm_client, message_bus):
        super().__init__(name, role, llm_client)
        self.message_bus = message_bus
        self.pending_requests = {}

    async def start(self):
        """Start listening for messages."""
        await self.message_bus.subscribe(self.name, self._handle_message)

    async def _handle_message(self, message: AgentMessage):
        """Handle incoming message from another agent."""

        if message.requires_response:
            # This is a request - process and respond
            result = await self.process(message)
            await self._send_response(message, result)
        else:
            # This is a response to our earlier request
            if message.task_id in self.pending_requests:
                self.pending_requests[message.task_id].set_result(message.content)

    async def request_help(self, target_agent: str, task: str) -> str:
        """Request help from another agent."""

        task_id = str(uuid.uuid4())
        future = asyncio.Future()
        self.pending_requests[task_id] = future

        message = AgentMessage(
            from_agent=self.name,
            to_agent=target_agent,
            content=task,
            task_id=task_id,
            requires_response=True
        )

        await self.message_bus.send(target_agent, message)

        # Wait for response with timeout
        try:
            result = await asyncio.wait_for(future, timeout=60.0)
            return result
        except asyncio.TimeoutError:
            return "Request timed out"
        finally:
            del self.pending_requests[task_id]

    async def _send_response(self, original: AgentMessage, result: TaskResult):
        """Send response back to requesting agent."""

        response = AgentMessage(
            from_agent=self.name,
            to_agent=original.from_agent,
            content=result.result,
            task_id=original.task_id,
            requires_response=False
        )

        await self.message_bus.send(original.from_agent, response)

class MessageBus:
    """Simple in-memory message bus for agent communication."""

    def __init__(self):
        self.subscribers: dict[str, Callable] = {}

    async def subscribe(self, agent_name: str, handler: Callable):
        self.subscribers[agent_name] = handler

    async def send(self, target: str, message: AgentMessage):
        if target in self.subscribers:
            await self.subscribers[target](message)
        else:
            raise ValueError(f"Unknown agent: {target}")
```

### Pattern 3: Debate/Critic Pattern

Agents review and challenge each other's work:

```python
class DebateSystem:
    def __init__(self, llm_client, num_rounds: int = 3):
        self.llm = llm_client
        self.num_rounds = num_rounds

    async def debate(self, topic: str, perspectives: list[str]) -> str:
        """Run a multi-agent debate on a topic."""

        # Initialize perspectives
        agents = [
            self._create_perspective_agent(p)
            for p in perspectives
        ]

        debate_history = []

        # Initial positions
        for agent in agents:
            position = await agent.state_position(topic)
            debate_history.append({
                "agent": agent.perspective,
                "round": 0,
                "content": position
            })

        # Debate rounds
        for round_num in range(1, self.num_rounds + 1):
            for agent in agents:
                # Get other agents' latest positions
                others_positions = [
                    h for h in debate_history
                    if h["agent"] != agent.perspective and h["round"] == round_num - 1
                ]

                # Generate response/critique
                response = await agent.respond(topic, others_positions)

                debate_history.append({
                    "agent": agent.perspective,
                    "round": round_num,
                    "content": response
                })

        # Synthesize conclusion
        return await self._synthesize_debate(topic, debate_history)

    def _create_perspective_agent(self, perspective: str):
        return PerspectiveAgent(perspective, self.llm)

    async def _synthesize_debate(self, topic: str, history: list[dict]) -> str:
        """Synthesize debate into balanced conclusion."""

        debate_text = "\n\n".join([
            f"[{h['agent']} - Round {h['round']}]: {h['content']}"
            for h in history
        ])

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """You are synthesizing a multi-perspective debate.
                    Present a balanced conclusion that:
                    1. Acknowledges valid points from each perspective
                    2. Identifies areas of consensus
                    3. Notes unresolved disagreements
                    4. Provides actionable recommendations"""
                },
                {
                    "role": "user",
                    "content": f"Topic: {topic}\n\nDebate:\n{debate_text}"
                }
            ]
        )

        return response.choices[0].message.content

class PerspectiveAgent:
    def __init__(self, perspective: str, llm_client):
        self.perspective = perspective
        self.llm = llm_client

    async def state_position(self, topic: str) -> str:
        """State initial position on the topic."""

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": f"""You represent the {self.perspective} perspective.
                    Present a clear, well-reasoned position on the topic.
                    Be specific and provide supporting arguments."""
                },
                {
                    "role": "user",
                    "content": f"State your position on: {topic}"
                }
            ]
        )

        return response.choices[0].message.content

    async def respond(self, topic: str, others: list[dict]) -> str:
        """Respond to other perspectives."""

        others_text = "\n\n".join([
            f"[{o['agent']}]: {o['content']}"
            for o in others
        ])

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": f"""You represent the {self.perspective} perspective.
                    Respond to other viewpoints by:
                    1. Acknowledging valid points
                    2. Challenging weak arguments
                    3. Refining your own position
                    4. Finding common ground where possible"""
                },
                {
                    "role": "user",
                    "content": f"""Topic: {topic}

Other perspectives:
{others_text}

Provide your response."""
                }
            ]
        )

        return response.choices[0].message.content
```

## Practical Example: Document Processing Pipeline

```python
class DocumentProcessingPipeline:
    """Multi-agent pipeline for document processing."""

    def __init__(self, llm_client, storage):
        self.llm = llm_client
        self.storage = storage

        # Initialize agents
        self.extractor = ExtractionAgent(llm_client)
        self.validator = ValidationAgent(llm_client)
        self.enricher = EnrichmentAgent(llm_client)
        self.summarizer = SummaryAgent(llm_client)

    async def process_document(self, document: str, doc_type: str) -> dict:
        """Process document through agent pipeline."""

        # Stage 1: Extract structured data
        extraction_result = await self.extractor.extract(document, doc_type)

        if not extraction_result["success"]:
            return {"error": "Extraction failed", "details": extraction_result}

        # Stage 2: Validate extracted data
        validation_result = await self.validator.validate(
            extraction_result["data"],
            doc_type
        )

        if validation_result["issues"]:
            # Try to fix issues
            extraction_result = await self.extractor.extract(
                document,
                doc_type,
                feedback=validation_result["issues"]
            )

        # Stage 3: Enrich with additional context
        enriched = await self.enricher.enrich(extraction_result["data"])

        # Stage 4: Generate summary
        summary = await self.summarizer.summarize(document, enriched)

        return {
            "extracted_data": extraction_result["data"],
            "validation": validation_result,
            "enriched_data": enriched,
            "summary": summary
        }
```

## Conclusion

Multi-agent systems enable:
- **Specialization**: Each agent excels at specific tasks
- **Scalability**: Add agents for new capabilities
- **Robustness**: Redundancy and cross-checking
- **Complexity handling**: Break down hard problems

Start with hierarchical patterns (easier to debug), then evolve to peer-to-peer as your system matures. Always include monitoring to track inter-agent communication and task completion.
