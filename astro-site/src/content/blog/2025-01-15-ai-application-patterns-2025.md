---
title: "Five LLM Application Patterns, From Least to Most Autonomy"
description: "A practical ladder of LLM patterns on Azure in January 2025: structured outputs, grounded RAG, tool workflows, self-review and agents."
author: Michael John Peña
draft: false
date: 2025-01-15
tags:
  - AI
  - Architecture
  - Design Patterns
  - Azure OpenAI
  - RAG
---

In my experience the bigger risk in LLM projects is rarely model quality; it's picking a more autonomous pattern than the problem needs, then chasing failures that a simpler design would never have produced. Before choosing a framework, it's worth asking how much freedom the model actually needs. Every step up adds cost, latency and new ways to fail.

I think about LLM application patterns as a ladder. Start at the bottom and only climb when you have evidence the rung below can't do the job. This post walks through five rungs with what is real on Azure in mid-January 2025, and where I'd stop.

| Rung | Pattern | Who decides the steps | Typical failure |
|---|---|---|---|
| 1 | Single call with structured output | You | Wrong classification |
| 2 | Grounded retrieval (RAG) | You | Bad retrieval, unsupported claims |
| 3 | Tool-calling workflow | You, with the model filling arguments | Wrong arguments, partial failures |
| 4 | Generate, evaluate, refine | You, with a model as reviewer | Cost blow-out, reviewer agrees with itself |
| 5 | Agent | The model | Unbounded loops, unsafe actions |

## Rung 1: one call, typed output

A surprising amount of useful work is a single model call: classify a support ticket, extract fields from an email, map a messy column name to a canonical one. The pattern that makes this production-grade is structured outputs, where the model is constrained to a JSON schema you supply rather than being asked nicely to return JSON.

On Azure OpenAI, [structured outputs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs) arrived with the `gpt-4o` 2024-08-06 model and the 2024-08-01-preview API, and the 2024-10-21 API version is the first GA version that supports it. The `openai` Python package (1.59 at the time of writing) can take a Pydantic model directly and hand you back a parsed object.

```python
import os
from typing import Literal

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI
from pydantic import BaseModel

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com
    azure_ad_token_provider=token_provider,
    api_version="2024-10-21",
)
DEPLOYMENT = os.environ["AZURE_OPENAI_DEPLOYMENT"]  # a gpt-4o 2024-08-06 deployment


class TicketTriage(BaseModel):
    category: Literal["access", "data_quality", "pipeline_failure", "report_request", "other"]
    priority: Literal["low", "medium", "high"]
    affected_system: str
    summary: str


def triage(ticket_text: str) -> TicketTriage:
    completion = client.beta.chat.completions.parse(
        model=DEPLOYMENT,
        messages=[
            {"role": "system", "content": "Triage data platform support tickets. Be conservative with 'high'."},
            {"role": "user", "content": ticket_text},
        ],
        response_format=TicketTriage,
        temperature=0,
    )
    message = completion.choices[0].message
    if message.refusal:
        raise ValueError(f"Model refused: {message.refusal}")
    return message.parsed
```

The `Literal` types do real work here: the model cannot invent a sixth category, and your downstream code can switch on the value without defensive string matching. Two constraints to know: every field in a strict schema must be required (model "optional" as a nullable value instead), and not every JSON Schema keyword is supported, so keep schemas flat and boring.

My view is that this rung covers more use cases than most roadmaps admit. If a task can be framed as "read this, return that shape", don't let anyone sell you an agent for it.

## Rung 2: grounded retrieval

When the answer depends on your organisation's documents rather than the model's training data, you need retrieval. The architecture is well known by now, so I'll focus on the two decisions that matter most.

First, **retrieval quality caps answer quality**. Pure vector search misses exact identifiers like product codes and policy numbers; pure keyword search misses paraphrases. In Azure AI Search I default to hybrid queries (keyword plus vector, merged with Reciprocal Rank Fusion) with the semantic ranker on top. With [integrated vectorisation](https://learn.microsoft.com/en-us/azure/search/vector-search-integrated-vectorization), which went GA in the 2024-07-01 API, the service can embed the query for you through a vectoriser defined on the index, so the application sends text and nothing else. The `azure-search-documents` 11.5 release exposes this as `VectorizableTextQuery`. Keyless access has two prerequisites: role-based access must be enabled on the search service with the app identity holding **Search Index Data Reader**, and the search service's managed identity needs **Cognitive Services OpenAI User** on the Azure OpenAI resource so the vectoriser can call the embedding deployment.

Second, **make the model prove its grounding**. Ask for an answer *and* the IDs of the chunks it used, then check those IDs in code. Add these definitions to the same script (it continues from the first snippet), and finish it with the single `__main__` block shown. It assumes an index with a vectoriser and a semantic configuration named `default`:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import QueryType, VectorizableTextQuery

search_client = SearchClient(
    endpoint="https://<your-search-service>.search.windows.net",
    index_name="<your-index-name>",
    credential=DefaultAzureCredential(),
)


class GroundedAnswer(BaseModel):
    answered: bool
    answer: str
    cited_chunk_ids: list[str]


def retrieve(question: str, top: int = 5) -> list[dict]:
    results = search_client.search(
        search_text=question,
        vector_queries=[
            VectorizableTextQuery(text=question, k_nearest_neighbors=50, fields="content_vector")
        ],
        query_type=QueryType.SEMANTIC,
        semantic_configuration_name="default",
        select=["chunk_id", "title", "content"],
        top=top,
    )
    return [{"chunk_id": r["chunk_id"], "title": r["title"], "content": r["content"]} for r in results]


def answer(question: str) -> GroundedAnswer:
    chunks = retrieve(question)
    sources = "\n\n".join(f"[{c['chunk_id']}] {c['title']}\n{c['content']}" for c in chunks)
    completion = client.beta.chat.completions.parse(
        model=DEPLOYMENT,
        messages=[
            {
                "role": "system",
                "content": (
                    "Answer only from the sources provided. If they do not contain the answer, "
                    "set answered to false. Cite the IDs of every source you relied on."
                ),
            },
            {"role": "user", "content": f"Sources:\n{sources}\n\nQuestion: {question}"},
        ],
        response_format=GroundedAnswer,
        temperature=0,
    )
    message = completion.choices[0].message
    if message.refusal:
        raise ValueError(f"Model refused: {message.refusal}")
    result = message.parsed
    retrieved_ids = {c["chunk_id"] for c in chunks}
    if result.answered and (not result.cited_chunk_ids or not set(result.cited_chunk_ids) <= retrieved_ids):
        # Citations that don't match what we retrieved mean we can't trust the answer.
        return GroundedAnswer(answered=False, answer="I couldn't find a supported answer.", cited_chunk_ids=[])
    return result


if __name__ == "__main__":
    print(triage("Since this morning the finance Power BI report shows zero revenue for APAC."))
    print(answer("Who approves access to the finance workspace?"))
```

The citation check is cheap and deterministic. It won't catch a model that cites the right chunk and still misreads it, which is where Azure AI Content Safety's groundedness detection comes in, but that is still in preview, so I treat it as an extra signal rather than a gate. For the retrieval side on its own, see my earlier post on [RAG architecture patterns](/blog/2023-02-01-rag-architecture-patterns/).

When not to use RAG: if the corpus is small and stable enough to fit in the prompt, or if the "documents" are really rows in a database. For tabular questions, a tool that runs a parameterised query beats embedding a CSV every time.

## Rung 3: tool-calling workflows

The next rung lets the model fill in arguments for functions you've defined, while your code still decides the order of operations. "Extract the customer ID, look up their last five orders, draft a reply" is a fixed path with three steps. Write it as code, use function calling (with `strict: true` so arguments match your schema), and validate arguments before execution exactly as you would validate user input.

The interesting work is in the failure paths. If the model returns no tool call when your code expected one, treat that as an explicit branch (ask a clarifying question or route to a person) rather than letting `tool_calls` being `None` surface as a crash three lines later. Make read steps such as the order lookup idempotent so a retry is always safe, and push any write, such as sending the reply, to the last step so a failure halfway through leaves nothing to undo. If a write has to happen mid-flow, give it an idempotency key so a retried run can't send the same email twice.

This is the pattern Anthropic's December essay [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) calls a workflow, and I agree with its central advice: most systems that get called agents should be workflows. You get predictable cost, ordinary retries and logs your operations team can read. For long-running versions with human approvals, I wrote up [durable agentic workflows](/blog/2025-01-03-agentic-workflows-beyond-chatbots/).

## Rung 4: generate, evaluate, refine

Some outputs benefit from a second pass: a model drafts, another call critiques against explicit criteria, and the draft is revised. It works well for long-form content such as release notes or data dictionary entries, where "good" can be written as a checklist.

The trade-offs are real. Each loop multiplies token cost and latency, and a model reviewing its own output tends to approve it. Three rules keep this honest:

- **Cap the loop.** Two refinement rounds is usually where returns stop. Make the limit a constant in code, not a suggestion in the prompt.
- **Prefer deterministic checks.** Schema validation, a SQL parser, a link checker or a unit test is a better reviewer than another model call wherever one exists.
- **Score offline before you loop online.** The [Azure AI Evaluation SDK](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/develop/evaluate-sdk) (`azure-ai-evaluation`, GA since 1.0.0 in November 2024) gives you groundedness, relevance and coherence evaluators. Run them over a test set to find out whether the extra pass actually improves anything before you pay for it on every request.

Reasoning models change this calculation. With `o1` (2024-12-17) now available in Azure OpenAI, behind a limited-access registration form, some tasks that needed an explicit critique loop can be handled by a single call to a model that does its own deliberation. That is often simpler, though not always cheaper. I compared the options in [o1 and o3 in January 2025](/blog/2025-01-09-reasoning-models-o1-o3-evolution/).

## Rung 5: agents

At the top, the model chooses its own steps and tools in a loop. Azure AI Agent Service is in preview in Azure AI Foundry, with the `azure-ai-projects` SDK still in beta. The pattern earns its place when the path genuinely can't be known in advance, such as investigating an unfamiliar failure across several systems. I covered what is shippable today, and how to put approval gates on state-changing tools, in [AI agents in 2025](/blog/2025-01-01-ai-agents-2025-the-year-of-autonomous-systems/).

Autonomy needs harder limits, not softer ones, and they belong in code rather than the prompt:

- **A step budget.** Cap iterations or tool calls per run (I start around 10) and end the run with a clear status when it's hit.
- **Read-only tools by default.** Most investigation needs only queries and log reads. Every state-changing tool is a deliberate addition.
- **Approval gates on writes.** When a run pauses in `requires_action` for a state-changing tool, route it to a person instead of auto-submitting the tool output.
- **A cost ceiling.** Track tokens per run and stop at a fixed limit, because a looping agent spends money quietly.

The failure that justifies moving up from rung 3 is specific: your workflow keeps growing branches for cases you couldn't predict, and evaluation shows a fixed path is getting those cases wrong. If you can't point to that, stay with the workflow.

## Guardrails apply to every rung

Safety isn't a pattern you add at the end. At minimum:

- **Content filtering** is on by default for Azure OpenAI deployments. Configure it deliberately rather than inheriting the defaults blindly.
- **[Prompt Shields](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection)**, GA since August 2024, detects direct jailbreak attempts and indirect injection hidden in documents. The second matters from rung 2 upwards, because retrieved content is untrusted input.
- **Least-privilege identity.** Use Entra ID authentication as in the code above, not API keys, and give each application only the roles it needs. A model can only misuse the access you gave it.
- **Tracing and evaluation from the first prototype.** Without them you can't tell whether the next model version made things better or worse.

## Where to stop

My rule is simple: climb a rung only when you can name the specific failure at the current rung that the next one fixes, and you have an evaluation set that shows the improvement. "It might need to handle more complex requests" is not evidence.

In practice, the bulk of business value I see sits on rungs 1 to 3. They are cheaper to run, easier to test, and far easier to explain to a risk committee. Treat rungs 4 and 5 as specialist tools, and if you can draw the flow on a whiteboard, write it as code and let the model do the parts that need language.
