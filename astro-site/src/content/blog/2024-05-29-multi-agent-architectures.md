---
title: "Multi-Agent Architectures: Collaboration at Scale"
author: Michael John Peña
draft: false
date: 2024-05-29
tags:
  - AI Agents
  - Multi-Agent Systems
  - Architecture
  - Azure AI
  - Collaboration
---

Single agents have limits. Multi-agent systems multiply capabilities. Today I'm exploring architectures for agent collaboration.

## Why Multi-Agent?

**Single Agent Limitations:**
- Context window constraints
- Single perspective
- Sequential processing
- Knowledge bottleneck

**Multi-Agent Benefits:**
- Specialized expertise
- Parallel processing
- Diverse perspectives
- Scalable complexity

## Architecture Patterns

### 1. Peer-to-Peer

```python
from dataclasses import dataclass
from typing import Dict, List, Optional
import asyncio

@dataclass
class AgentMessage:
    from_agent: str
    to_agent: str
    content: str
    message_type: str  # "request", "response", "broadcast"

class PeerToPeerNetwork:
    """Agents communicate directly with each other."""

    def __init__(self):
        self.agents: Dict[str, 'BaseAgent'] = {}
        self.message_queue: asyncio.Queue = asyncio.Queue()

    def register_agent(self, agent: 'BaseAgent'):
        self.agents[agent.name] = agent
        agent.network = self

    async def send_message(self, message: AgentMessage):
        await self.message_queue.put(message)

    async def broadcast(self, from_agent: str, content: str):
        for agent_name in self.agents:
            if agent_name != from_agent:
                await self.send_message(AgentMessage(
                    from_agent=from_agent,
                    to_agent=agent_name,
                    content=content,
                    message_type="broadcast"
                ))

    async def run(self):
        while True:
            message = await self.message_queue.get()
            target_agent = self.agents.get(message.to_agent)
            if target_agent:
                asyncio.create_task(target_agent.receive_message(message))

class BaseAgent:
    def __init__(self, name: str, client):
        self.name = name
        self.client = client
        self.network: Optional[PeerToPeerNetwork] = None

    async def receive_message(self, message: AgentMessage):
        response = await self.process_message(message)
        if response and message.message_type == "request":
            await self.network.send_message(AgentMessage(
                from_agent=self.name,
                to_agent=message.from_agent,
                content=response,
                message_type="response"
            ))

    async def process_message(self, message: AgentMessage) -> Optional[str]:
        raise NotImplementedError
```

### 2. Hub-and-Spoke (Coordinator)

```python
class CoordinatorAgent:
    """Central coordinator managing specialist agents."""

    def __init__(self, client, specialists: Dict[str, 'SpecialistAgent']):
        self.client = client
        self.specialists = specialists

    async def process_request(self, request: str) -> dict:
        # Analyze request and create execution plan
        plan = await self._create_plan(request)

        # Execute plan
        results = {}
        for step in plan["steps"]:
            specialist = self.specialists.get(step["specialist"])
            if specialist:
                result = await specialist.execute(step["task"], results)
                results[step["id"]] = result

        # Synthesize final response
        return await self._synthesize(request, results)

    async def _create_plan(self, request: str) -> dict:
        specialists_desc = {
            name: agent.description
            for name, agent in self.specialists.items()
        }

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""Create an execution plan using these specialists: {json.dumps(specialists_desc)}
Return JSON: {{"steps": [{{"id": "step1", "specialist": "name", "task": "description", "depends_on": []}}]}}"""
                },
                {"role": "user", "content": request}
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def _synthesize(self, request: str, results: dict) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Synthesize these results into a coherent response."
                },
                {
                    "role": "user",
                    "content": f"Original request: {request}\n\nResults: {json.dumps(results)}"
                }
            ]
        )

        return {
            "response": response.choices[0].message.content,
            "execution_details": results
        }

class SpecialistAgent:
    def __init__(self, name: str, description: str, client, tools: list = None):
        self.name = name
        self.description = description
        self.client = client
        self.tools = tools or []

    async def execute(self, task: str, context: dict) -> str:
        messages = [
            {
                "role": "system",
                "content": f"You are a {self.name}. {self.description}"
            },
            {
                "role": "user",
                "content": f"Task: {task}\n\nContext from previous steps: {json.dumps(context)}"
            }
        ]

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=self.tools if self.tools else None
        )

        return response.choices[0].message.content
```

### 3. Hierarchical Organization

```python
class HierarchicalSystem:
    """Multi-level agent hierarchy."""

    def __init__(self, client):
        self.client = client
        self.executive = ExecutiveAgent(client)
        self.departments = {}

    def add_department(self, name: str, manager: 'ManagerAgent', workers: List['WorkerAgent']):
        self.departments[name] = {
            "manager": manager,
            "workers": {w.name: w for w in workers}
        }
        manager.workers = self.departments[name]["workers"]

    async def execute_initiative(self, initiative: str) -> dict:
        # Executive creates strategic plan
        strategic_plan = await self.executive.create_strategy(
            initiative,
            list(self.departments.keys())
        )

        # Departments execute their portions
        department_results = {}
        for dept_name, objectives in strategic_plan["department_objectives"].items():
            if dept_name in self.departments:
                dept = self.departments[dept_name]
                result = await dept["manager"].execute_objectives(objectives)
                department_results[dept_name] = result

        # Executive reviews and finalizes
        return await self.executive.finalize(initiative, department_results)

class ExecutiveAgent:
    def __init__(self, client):
        self.client = client

    async def create_strategy(self, initiative: str, departments: list) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are an executive agent. Create a strategic plan.
Available departments: {departments}
Return JSON with department_objectives mapping."""
                },
                {"role": "user", "content": f"Initiative: {initiative}"}
            ],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

    async def finalize(self, initiative: str, results: dict) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Create final executive summary and recommendations."
                },
                {
                    "role": "user",
                    "content": f"Initiative: {initiative}\nDepartment results: {json.dumps(results)}"
                }
            ]
        )
        return {
            "summary": response.choices[0].message.content,
            "detailed_results": results
        }

class ManagerAgent:
    def __init__(self, name: str, client):
        self.name = name
        self.client = client
        self.workers: Dict[str, 'WorkerAgent'] = {}

    async def execute_objectives(self, objectives: list) -> dict:
        # Create work assignments
        assignments = await self._create_assignments(objectives)

        # Execute assignments
        results = {}
        for assignment in assignments:
            worker = self.workers.get(assignment["worker"])
            if worker:
                result = await worker.execute(assignment["task"])
                results[assignment["id"]] = result

        # Review and integrate
        return await self._integrate_results(objectives, results)

class WorkerAgent:
    def __init__(self, name: str, specialty: str, client, tools: list = None):
        self.name = name
        self.specialty = specialty
        self.client = client
        self.tools = tools

    async def execute(self, task: str) -> str:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"You are a {self.specialty}. Complete tasks efficiently."
                },
                {"role": "user", "content": task}
            ],
            tools=self.tools
        )
        return response.choices[0].message.content
```

### 4. Debate/Adversarial

```python
class DebateSystem:
    """Agents debate to reach better conclusions."""

    def __init__(self, client, num_rounds: int = 3):
        self.client = client
        self.num_rounds = num_rounds

    async def debate(self, topic: str, positions: List[str]) -> dict:
        agents = [
            DebateAgent(f"Agent_{i}", position, self.client)
            for i, position in enumerate(positions)
        ]

        debate_history = []

        # Opening statements
        statements = await asyncio.gather(*[
            agent.opening_statement(topic)
            for agent in agents
        ])
        debate_history.append({
            "round": "opening",
            "statements": {agent.name: stmt for agent, stmt in zip(agents, statements)}
        })

        # Debate rounds
        for round_num in range(self.num_rounds):
            round_responses = {}
            for agent in agents:
                other_positions = [
                    s for name, s in debate_history[-1]["statements"].items()
                    if name != agent.name
                ]
                response = await agent.respond(topic, other_positions, debate_history)
                round_responses[agent.name] = response

            debate_history.append({
                "round": round_num + 1,
                "statements": round_responses
            })

        # Judge synthesizes
        verdict = await self._judge(topic, debate_history)

        return {
            "topic": topic,
            "debate_history": debate_history,
            "verdict": verdict
        }

    async def _judge(self, topic: str, history: list) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """You are an impartial judge. Analyze the debate and determine:
1. Strongest arguments from each side
2. Weaknesses in each position
3. A synthesized conclusion that incorporates the best insights
Return JSON with these fields."""
                },
                {
                    "role": "user",
                    "content": f"Topic: {topic}\n\nDebate: {json.dumps(history)}"
                }
            ],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

class DebateAgent:
    def __init__(self, name: str, position: str, client):
        self.name = name
        self.position = position
        self.client = client

    async def opening_statement(self, topic: str) -> str:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"You argue for this position: {self.position}. Make compelling opening statement."
                },
                {"role": "user", "content": f"Topic: {topic}"}
            ]
        )
        return response.choices[0].message.content

    async def respond(self, topic: str, other_positions: list, history: list) -> str:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"You argue for: {self.position}. Respond to opponents and strengthen your position."
                },
                {
                    "role": "user",
                    "content": f"Topic: {topic}\nOpponent statements: {other_positions}"
                }
            ]
        )
        return response.choices[0].message.content
```

## Communication Protocols

```python
from enum import Enum
from dataclasses import dataclass

class MessagePriority(Enum):
    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4

@dataclass
class AgentProtocolMessage:
    id: str
    sender: str
    recipients: List[str]
    message_type: str  # "task", "result", "query", "notification"
    content: dict
    priority: MessagePriority
    requires_response: bool
    correlation_id: Optional[str] = None  # For request-response pairing
    ttl: int = 3600  # Time to live in seconds

class MessageBus:
    """Centralized message bus for agent communication."""

    def __init__(self):
        self.subscribers: Dict[str, List[asyncio.Queue]] = {}
        self.message_history: List[AgentProtocolMessage] = []

    def subscribe(self, agent_name: str) -> asyncio.Queue:
        if agent_name not in self.subscribers:
            self.subscribers[agent_name] = []
        queue = asyncio.Queue()
        self.subscribers[agent_name].append(queue)
        return queue

    async def publish(self, message: AgentProtocolMessage):
        self.message_history.append(message)

        for recipient in message.recipients:
            if recipient in self.subscribers:
                for queue in self.subscribers[recipient]:
                    await queue.put(message)

    async def broadcast(self, message: AgentProtocolMessage):
        self.message_history.append(message)
        for agent_name, queues in self.subscribers.items():
            if agent_name != message.sender:
                for queue in queues:
                    await queue.put(message)
```

## Scaling Considerations

```python
class ScalableMultiAgentSystem:
    """Multi-agent system designed for scale."""

    def __init__(self, config: dict):
        self.config = config
        self.agent_pool: Dict[str, List['BaseAgent']] = {}
        self.load_balancer = LoadBalancer()

    async def scale_agent_type(self, agent_type: str, count: int):
        """Scale up/down agents of a specific type."""
        current_count = len(self.agent_pool.get(agent_type, []))

        if count > current_count:
            # Scale up
            for _ in range(count - current_count):
                agent = self._create_agent(agent_type)
                self.agent_pool.setdefault(agent_type, []).append(agent)
        elif count < current_count:
            # Scale down
            self.agent_pool[agent_type] = self.agent_pool[agent_type][:count]

    async def route_task(self, task: dict) -> str:
        """Route task to appropriate agent."""
        agent_type = self._determine_agent_type(task)
        agent = self.load_balancer.get_available_agent(
            self.agent_pool.get(agent_type, [])
        )

        if not agent:
            # Auto-scale
            await self.scale_agent_type(agent_type, 1)
            agent = self.agent_pool[agent_type][0]

        return await agent.execute(task)

class LoadBalancer:
    def get_available_agent(self, agents: List['BaseAgent']) -> Optional['BaseAgent']:
        # Round-robin with availability check
        available = [a for a in agents if not a.is_busy]
        if available:
            return min(available, key=lambda a: a.current_load)
        return None
```

## Best Practices

1. **Clear interfaces** - Define communication protocols
2. **Loose coupling** - Agents should be independently deployable
3. **Monitor everything** - Track agent interactions
4. **Handle failures** - Graceful degradation when agents fail
5. **Test interactions** - Unit test agents, integration test the system

## What's Next

Tomorrow I'll wrap up May with a summary of the best practices for AI agent development.

## Resources

- [AutoGen](https://microsoft.github.io/autogen/)
- [CrewAI](https://github.com/joaomdmoura/crewAI)
- [LangGraph](https://python.langchain.com/docs/langgraph)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
