---
title: "Building AI Applications: Choosing the Right Platform and Architecture"
author: Michael John Peña
draft: false
date: 2024-11-06
tags:
  - Azure
  - AI
  - Architecture
  - Application Development
  - Best Practices

---

I wrote "Building AI Applications: Choosing the Right Platform and Architecture" to share practical, production-minded guidance on this topic.

## The AI Application Stack

Modern AI applications typically consist of:

```
┌─────────────────────────────────────────┐
│           User Interface                 │
│    (Web, Mobile, Chat, Voice, API)      │
├─────────────────────────────────────────┤
│        Application Layer                 │
│   (Business Logic, Orchestration)       │
├─────────────────────────────────────────┤
│          AI Layer                        │
│  (Models, Agents, Embeddings, RAG)      │
├─────────────────────────────────────────┤
│         Data Layer                       │
│  (Vector DB, Lakehouse, Cache)          │
├─────────────────────────────────────────┤
│       Infrastructure                     │
│    (Compute, Network, Security)         │
└─────────────────────────────────────────┘
```

## Architecture Patterns

### Pattern 1: Simple RAG Application

```python
from azure.ai.foundry import AIFoundryClient
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

class SimpleRAGApp:
    """Basic RAG pattern for document Q&A."""

    def __init__(self):
        self.ai_client = AIFoundryClient(...)
        self.search_client = SearchClient(...)

    async def answer_question(self, question: str) -> str:
        # 1. Generate embedding for the question
        embedding = await self.ai_client.embeddings.create(
            model="text-embedding-3-large",
            input=question
        )

        # 2. Search for relevant documents
        vector_query = VectorizedQuery(
            vector=embedding.data[0].embedding,
            k_nearest_neighbors=5,
            fields="content_vector"
        )

        search_results = self.search_client.search(
            search_text=question,
            vector_queries=[vector_query],
            select=["title", "content", "source"]
        )

        # 3. Build context from search results
        context = "\n\n".join([
            f"Source: {doc['source']}\n{doc['content']}"
            for doc in search_results
        ])

        # 4. Generate answer
        response = await self.ai_client.chat.complete(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""Answer questions based on the provided context.
                    If the answer isn't in the context, say so.

                    Context:
                    {context}"""
                },
                {"role": "user", "content": question}
            ]
        )

        return response.choices[0].message.content

# Usage
app = SimpleRAGApp()
answer = await app.answer_question("What is our refund policy?")
```

### Pattern 2: Multi-Agent System

```python
from azure.ai.foundry.agents import Agent, Orchestra, Router

class MultiAgentSystem:
    """Complex system with specialized agents."""

    def __init__(self):
        self.client = AIFoundryClient(...)

        # Define specialized agents
        self.research_agent = Agent(
            name="Researcher",
            model="gpt-4o",
            instructions="""You research topics thoroughly.
            Use web search and document retrieval.""",
            tools=[WebSearchTool(), DocumentSearchTool()]
        )

        self.analyst_agent = Agent(
            name="Analyst",
            model="gpt-4o",
            instructions="""You analyze data and create insights.
            Use SQL queries and calculations.""",
            tools=[SQLQueryTool(), CalculatorTool()]
        )

        self.writer_agent = Agent(
            name="Writer",
            model="gpt-4o",
            instructions="""You write clear, professional content.
            Create reports, summaries, and documentation.""",
            tools=[DocumentGeneratorTool()]
        )

        # Create router for intelligent task distribution
        self.router = Router(
            agents=[self.research_agent, self.analyst_agent, self.writer_agent],
            strategy="semantic"  # Routes based on task understanding
        )

        # Create orchestra for multi-agent coordination
        self.orchestra = Orchestra(
            agents=[self.research_agent, self.analyst_agent, self.writer_agent],
            coordinator_model="gpt-4o"
        )

    async def handle_simple_task(self, task: str) -> str:
        """Route to single best agent."""
        agent = await self.router.select_agent(task)
        response = await agent.run(task)
        return response.content

    async def handle_complex_task(self, task: str) -> str:
        """Coordinate multiple agents."""
        result = await self.orchestra.run(
            task=task,
            max_iterations=10,
            require_approval=False
        )
        return result.final_output

# Usage
system = MultiAgentSystem()

# Simple task - routed to single agent
answer = await system.handle_simple_task(
    "What were our sales numbers last month?"
)

# Complex task - orchestrated across agents
report = await system.handle_complex_task(
    """Create a market analysis report:
    1. Research our top 3 competitors
    2. Analyze our sales trends vs market
    3. Write an executive summary with recommendations"""
)
```

### Pattern 3: Event-Driven AI Pipeline

```python
from azure.functions import FunctionApp
from azure.ai.foundry import AIFoundryClient
from azure.servicebus import ServiceBusClient
import json

app = FunctionApp()

@app.service_bus_queue_trigger(
    queue_name="document-processing",
    connection="SERVICE_BUS_CONNECTION"
)
async def process_document(msg: str):
    """Event-driven document processing pipeline."""

    client = AIFoundryClient(...)
    event = json.loads(msg)

    document_url = event["document_url"]
    document_type = event["document_type"]

    # 1. Extract content
    content = await extract_document_content(document_url)

    # 2. Classify document
    classification = await client.chat.complete(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "Classify documents into categories: invoice, contract, report, correspondence"
            },
            {"role": "user", "content": f"Classify: {content[:2000]}"}
        ],
        response_format={"type": "json_object"}
    )

    doc_class = json.loads(classification.choices[0].message.content)

    # 3. Extract entities based on classification
    extraction_prompt = get_extraction_prompt(doc_class["category"])

    entities = await client.chat.complete(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": extraction_prompt},
            {"role": "user", "content": content}
        ],
        response_format={"type": "json_object"}
    )

    # 4. Store results
    await store_processed_document(
        document_url=document_url,
        classification=doc_class,
        entities=json.loads(entities.choices[0].message.content)
    )

    # 5. Trigger downstream workflows
    if doc_class["category"] == "invoice":
        await trigger_invoice_workflow(event["document_id"])
```

## Choosing Your Architecture

| Requirement | Recommended Pattern |
|------------|---------------------|
| Simple Q&A | Simple RAG |
| Document search | Simple RAG with filters |
| Task completion | Single Agent |
| Complex workflows | Multi-Agent Orchestra |
| High throughput | Event-Driven Pipeline |
| Real-time chat | Streaming with WebSockets |
| Batch processing | Azure Functions + Queue |

## Production Considerations

### Caching Strategy

```python
from azure.ai.foundry.caching import SemanticCache

class CachedAIApp:
    def __init__(self):
        self.cache = SemanticCache(
            connection_string=os.getenv("REDIS_CONNECTION"),
            embedding_model="text-embedding-3-small",
            similarity_threshold=0.95,
            ttl_seconds=3600
        )
        self.client = AIFoundryClient(...)

    async def get_answer(self, question: str) -> str:
        # Check cache first
        cached = await self.cache.get(question)
        if cached:
            return cached

        # Generate new response
        response = await self.client.chat.complete(
            model="gpt-4o",
            messages=[{"role": "user", "content": question}]
        )

        answer = response.choices[0].message.content

        # Cache the response
        await self.cache.set(question, answer)

        return answer
```

### Error Handling

```python
from azure.ai.foundry.errors import (
    RateLimitError,
    ContentFilterError,
    ModelOverloadedError
)
from tenacity import retry, wait_exponential, stop_after_attempt

class ResilientAIApp:
    @retry(
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(3),
        retry=lambda e: isinstance(e, (RateLimitError, ModelOverloadedError))
    )
    async def generate_with_retry(self, prompt: str) -> str:
        try:
            response = await self.client.chat.complete(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content

        except ContentFilterError as e:
            # Log and return safe response
            logger.warning(f"Content filtered: {e}")
            return "I'm unable to process this request."

        except RateLimitError:
            # Will be retried
            raise
```

The key to successful AI applications is choosing the right architecture for your requirements and building with production considerations from the start.

## Resources

- [AI Architecture Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/)
- [Azure AI Foundry Best Practices](https://learn.microsoft.com/en-us/azure/ai-foundry/best-practices)
- [Enterprise AI Guidelines](https://learn.microsoft.com/en-us/azure/architecture/example-scenario/ai/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
