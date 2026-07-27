---
title: "Semantic Kernel Introduction: Microsoft's AI Orchestration SDK"
author: Michael John Peña
draft: false
date: 2023-02-16
tags:
  - Semantic Kernel
  - Azure
  - OpenAI
  - AI
  - Microsoft

---

I wrote "Semantic Kernel Introduction: Microsoft's AI Orchestration SDK" to share practical, production-minded guidance on this topic.

## Getting Started

```bash
pip install semantic-kernel
```

```python
import semantic_kernel as sk
from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion

# Create kernel
kernel = sk.Kernel()

# Add Azure OpenAI service
kernel.add_chat_service(
    "azure_chat",
    AzureChatCompletion(
        deployment_name="gpt-35-turbo",
        endpoint="https://your-resource.openai.azure.com/",
        api_key="your-api-key"
    )
)
```

## Semantic Functions

Define AI functions using natural language prompts:

```python
# Inline semantic function
summarize_function = kernel.create_semantic_function(
    prompt_template="""
Summarize the following text in {{$style}} style:

{{$input}}

Summary:""",
    function_name="summarize",
    skill_name="TextSkill",
    max_tokens=200,
    temperature=0.5
)

# Use the function
result = await summarize_function.invoke_async(
    input="Azure OpenAI Service provides REST API access to OpenAI's powerful language models...",
    style="bullet points"
)
print(result)
```

## Prompt Templates

Create reusable prompts:

```python
from semantic_kernel.prompt_template.prompt_template_config import PromptTemplateConfig

# Define template configuration
template_config = PromptTemplateConfig(
    description="Explains technical concepts",
    input_variables=[
        {"name": "topic", "description": "The topic to explain"},
        {"name": "audience", "description": "Target audience"}
    ]
)

# Create function from template
explain_template = """
You are a technical educator. Explain {{$topic}} to {{$audience}}.

Requirements:
- Use simple language
- Include practical examples
- Keep it under 200 words

Explanation:
"""

explain_function = kernel.create_semantic_function(
    prompt_template=explain_template,
    function_name="explain",
    skill_name="Education",
    prompt_template_config=template_config
)
```

## Native Functions

Add Python functions as skills:

```python
from semantic_kernel.skill_definition import sk_function, sk_function_context_parameter

class MathSkill:
    """Math operations skill."""

    @sk_function(
        description="Calculates the sum of two numbers",
        name="add"
    )
    @sk_function_context_parameter(name="a", description="First number")
    @sk_function_context_parameter(name="b", description="Second number")
    def add(self, context: sk.SKContext) -> str:
        a = float(context["a"])
        b = float(context["b"])
        return str(a + b)

    @sk_function(
        description="Calculates Azure monthly cost",
        name="estimate_cost"
    )
    @sk_function_context_parameter(name="hours", description="Compute hours per month")
    @sk_function_context_parameter(name="rate", description="Hourly rate in dollars")
    def estimate_cost(self, context: sk.SKContext) -> str:
        hours = float(context["hours"])
        rate = float(context["rate"])
        total = hours * rate
        return f"${total:.2f} per month"

# Register the skill
kernel.import_skill(MathSkill(), "Math")

# Use native function
math_func = kernel.skills.get_function("Math", "estimate_cost")
result = await math_func.invoke_async(hours="720", rate="0.05")
print(result)
```

## Chaining Functions

Combine functions into pipelines:

```python
# Create a pipeline
async def process_document(kernel, document: str):
    """Process document with multiple steps."""

    context = kernel.create_new_context()
    context["input"] = document

    # Step 1: Summarize
    summarize = kernel.skills.get_function("TextSkill", "summarize")
    context["style"] = "concise"
    result = await summarize.invoke_async(context=context)
    summary = str(result)

    # Step 2: Extract key points
    extract = kernel.skills.get_function("TextSkill", "extract_key_points")
    context["input"] = summary
    result = await extract.invoke_async(context=context)

    return str(result)

# Or use planner for automatic chaining
```

## Memory and Embeddings

Store and retrieve information:

```python
from semantic_kernel.connectors.ai.open_ai import AzureTextEmbedding
from semantic_kernel.memory.volatile_memory_store import VolatileMemoryStore

# Add embedding service
kernel.add_text_embedding_generation_service(
    "azure_embedding",
    AzureTextEmbedding(
        deployment_name="text-embedding-ada-002",
        endpoint="https://your-resource.openai.azure.com/",
        api_key="your-api-key"
    )
)

# Register memory store
kernel.register_memory_store(memory_store=VolatileMemoryStore())

# Save information to memory
async def populate_memory(kernel):
    await kernel.memory.save_information_async(
        collection="azure_docs",
        text="Azure Functions is a serverless compute service",
        id="func_001",
        description="Azure Functions overview"
    )

    await kernel.memory.save_information_async(
        collection="azure_docs",
        text="Azure Cosmos DB is a globally distributed database",
        id="cosmos_001",
        description="Cosmos DB overview"
    )

# Search memory
async def search_memory(kernel, query: str):
    results = await kernel.memory.search_async(
        collection="azure_docs",
        query=query,
        limit=3,
        min_relevance_score=0.7
    )

    for result in results:
        print(f"[{result.relevance:.2f}] {result.text}")

    return results
```

## Planners

Automatically create execution plans:

```python
from semantic_kernel.planning import SequentialPlanner, ActionPlanner

# Sequential Planner - creates step-by-step plans
sequential_planner = SequentialPlanner(kernel)

# Create plan for complex goal
plan = await sequential_planner.create_plan_async(
    goal="Analyze the Azure documentation and create a summary with cost estimates"
)

print("Plan steps:")
for step in plan._steps:
    print(f"  - {step.skill_name}.{step.name}")

# Execute plan
result = await plan.invoke_async()

# Action Planner - selects single best action
action_planner = ActionPlanner(kernel)

action_plan = await action_planner.create_plan_async(
    goal="What Azure service should I use for serverless APIs?"
)

result = await action_plan.invoke_async()
```

## RAG with Semantic Kernel

```python
class SemanticKernelRAG:
    """RAG implementation with Semantic Kernel."""

    def __init__(self):
        self.kernel = sk.Kernel()
        self._setup_services()
        self._setup_skills()

    def _setup_services(self):
        """Configure AI services."""
        self.kernel.add_chat_service(
            "chat",
            AzureChatCompletion(
                deployment_name="gpt-35-turbo",
                endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                api_key=os.getenv("AZURE_OPENAI_KEY")
            )
        )

        self.kernel.add_text_embedding_generation_service(
            "embedding",
            AzureTextEmbedding(
                deployment_name="text-embedding-ada-002",
                endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                api_key=os.getenv("AZURE_OPENAI_KEY")
            )
        )

        self.kernel.register_memory_store(
            memory_store=VolatileMemoryStore()
        )

    def _setup_skills(self):
        """Create semantic functions."""
        self.qa_function = self.kernel.create_semantic_function(
            prompt_template="""
Answer the question based on the provided context.
If the context doesn't contain relevant information, say so.

Context:
{{$context}}

Question: {{$question}}

Answer:""",
            function_name="answer",
            skill_name="QA",
            max_tokens=500,
            temperature=0.3
        )

    async def add_document(self, doc_id: str, content: str, collection: str = "docs"):
        """Add document to memory."""
        await self.kernel.memory.save_information_async(
            collection=collection,
            text=content,
            id=doc_id
        )

    async def query(self, question: str, collection: str = "docs") -> dict:
        """Query the knowledge base."""
        # Retrieve relevant documents
        memories = await self.kernel.memory.search_async(
            collection=collection,
            query=question,
            limit=5,
            min_relevance_score=0.7
        )

        # Build context
        context_parts = [mem.text for mem in memories]
        context = "\n\n".join(context_parts)

        # Generate answer
        sk_context = self.kernel.create_new_context()
        sk_context["context"] = context
        sk_context["question"] = question

        result = await self.qa_function.invoke_async(context=sk_context)

        return {
            "answer": str(result),
            "sources": [mem.id for mem in memories]
        }

# Usage
rag = SemanticKernelRAG()
await rag.add_document("doc1", "Azure Functions provides serverless compute...")
result = await rag.query("What is Azure Functions?")
```

## Best Practices

1. **Organize skills logically**: Group related functions
2. **Use planners wisely**: They add latency
3. **Manage context size**: SK doesn't auto-truncate
4. **Handle errors**: Wrap async calls in try/except
5. **Test prompts**: Iterate on prompt templates

## Resources

- [Semantic Kernel Documentation](https://learn.microsoft.com/semantic-kernel/)
- [GitHub Repository](https://github.com/microsoft/semantic-kernel)
- [Sample Applications](https://github.com/microsoft/semantic-kernel/tree/main/samples)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
