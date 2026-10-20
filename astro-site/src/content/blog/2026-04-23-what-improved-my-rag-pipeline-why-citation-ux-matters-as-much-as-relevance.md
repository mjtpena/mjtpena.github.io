---
title: "RAG Citations People Can Check: Treat Them as Part of the Answer"
description: "Good retrieval is wasted if users cannot verify the answer, so design RAG citations to be checkable, validated in code and measured like relevance."
author: Michael John Peña
draft: false
date: 2026-04-23
tags:
  - RAG
  - Azure AI Search
  - Azure OpenAI
  - Evaluation
  - Python
---

Most RAG tuning effort goes into relevance: better chunks, hybrid search, a reranker, a cleaner golden set. Users never see any of that. What they see is an answer and a row of little numbered links, and if clicking one opens a 60-page PDF at page one, they stop clicking. From then on they either trust the bot blindly or not at all, and both outcomes are bad.

My position: citations are part of the answer, not decoration added after it. A citation that doesn't let someone confirm a claim in a few seconds has failed, even when the retrieval behind it was perfect. That means designing what a citation contains, checking citations in code rather than trusting the model's markers, and measuring citation quality next to retrieval quality.

## Relevance and verifiability are different metrics

Retrieval metrics answer "did the right chunk reach the context window?" Groundedness metrics answer "is the answer supported by the context as a whole?" Neither answers the question a user actually has: "which source says *this sentence*, and where?"

Three failures pass both of those checks and still break trust:

- **Right chunk, wrong pointer.** The answer is grounded, but the model attaches `[2]` to a claim that came from source 4. A groundedness score computed over the whole context won't notice. The user clicks `[2]`, can't find the claim, and concludes the answer was made up.
- **Right pointer, useless destination.** The citation links to the document root. The supporting sentence is on page 37, so for practical purposes there's no citation at all.
- **Citation padding.** Every source retrieved gets listed under the answer, whether it was used or not. Five citations look thorough. One of them is relevant.

If you've built your evaluation the way I described in [Gating LLM Changes on Groundedness Flips, Not Fluency Averages](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/), you're measuring the answer. This post is about measuring and designing the pointer.

## What a useful citation contains

A citation is a small piece of UI with a job: get the reader from a claim to the evidence quickly. This is what I'd want each one to carry, and where it comes from in an Azure AI Search pipeline.

| Element | Why it matters | Where it comes from |
|---|---|---|
| Marker on the specific claim | Ties evidence to a sentence, not to the whole answer | The model's output, checked in code |
| Document title | Lets the reader judge the source before clicking | A retrievable field in the index |
| Deep link (page, section or anchor) | Removes the "open and search" step | Page or heading captured at chunking time |
| Supporting passage, highlighted | Often makes the click unnecessary | Semantic ranker captions |
| Last modified date | Flags stale policy before someone acts on it | Source metadata, mapped at indexing |

The deep link is the one teams skip, and you can't fix it later at query time. If your chunker throws away the page number or section heading, no amount of prompt work recovers it. I'd treat `page` and `section` as required fields in the chunk schema, the same way you'd treat a foreign key. For PDFs, a `#page=N` fragment on the URL is honoured by the common browser PDF viewers, which is enough to land people in the right place.

A deep link only helps if it opens for the person reading it. The `url` in your index usually points at blob storage or SharePoint, and that link has to resolve with the reader's own permissions, whether through a short-lived SAS, an app proxy or their SharePoint access. The same goes for the passage you show on hover: it is document text. In permission-sensitive corpora such as HR and policy, retrieval needs [security trimming](https://learn.microsoft.com/azure/search/search-security-trimming-for-azure-search), a permission filter or document-level access, so a caption never surfaces text the user couldn't open themselves.

The supporting passage is where Azure AI Search does a lot of the work for you. With semantic ranking, you can ask for [extractive captions with highlighting](https://learn.microsoft.com/azure/search/semantic-how-to-query-request). Captions are verbatim text pulled from the indexed content, not generated, so they're safe to show as evidence. They're usually under 200 words and come with the key phrases marked. In my view, showing that passage on hover or expand does more for citation UX than any other single change, because most users only want to see the sentence, not open the file.

Two constraints to design around. First, semantic ranking only reranks the top 50 results from the initial query. That's plenty for a RAG context window, but it means captions don't exist for anything below that line. Second, the semantic ranker is [billed by usage](https://learn.microsoft.com/azure/search/semantic-how-to-enable-disable). Every service, including the Free tier in supported regions, starts on a free plan with a monthly request allowance. Past that, you need the pay-as-you-go standard plan, which requires Basic or higher. Budget for it at production query volumes.

If semantic ranking is off, or a result comes back without a caption, the script below falls back to the first 300 characters of the chunk as the passage. That's still verbatim, but it's a weaker preview because it isn't picked for relevance to the question.

## Let the model choose, let code verify

There are three common ways to get citations out of a RAG pipeline.

| Approach | Strength | Weakness |
|---|---|---|
| Inline markers in free text (`[doc2]`) | Simple, streams well | Fragile to parse, nothing stops invalid or missing markers |
| Platform-managed citations (agent tools, Azure AI Search knowledge bases) | Little code to write | You render what the platform returns, in its shape, with less control over granularity |
| Structured output: claims with source IDs | Every claim is checkable in code | Streaming is possible but you get partial JSON, not readable prose, so the UI usually waits for each claim to complete; a little more latency |

If you're weighing [Azure AI Search knowledge bases](https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-create-knowledge-base), check the status of the piece you need: extractive retrieval is GA in REST 2026-04-01, but answer synthesis is still in preview (2025-11-01-preview).

For anything where people act on the answer, such as policy, HR, finance or engineering runbooks, I'd use [structured outputs](https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs). This needs a deployment of a model that supports structured outputs (gpt-4o 2024-08-06 or later, gpt-4.1, the gpt-5 family); check the supported-models list on that page. The model returns a list of claims, each with the IDs of the numbered sources that support it. Then code does what the model can't be trusted to do: drop IDs that weren't in the context, drop claims with no surviving support, renumber citations in order of first use, and attach the caption and deep link from the search result rather than from anything the model wrote.

That last point matters. The model only ever outputs integers. Titles, URLs and passages come straight from the index, so a hallucinated link is impossible by construction.

The script below runs one question end to end. It uses `azure-search-documents` 11.6.0, the current GA release, for a hybrid semantic query, and the `openai` 2.32.0 library against the [Azure OpenAI v1 endpoint](https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle), so there's no `api-version` to manage. It assumes an index with a vectorizer on the vector field, a semantic configuration, and five retrievable fields: `chunk` (the chunk text), `title`, `url`, `page` and `last_modified`. Rename those in the `select` list and the code if your schema differs. Keyless auth needs role-based access enabled on the search service (API Access control set to Role-based or Both), the Search Index Data Reader role on the index, and Cognitive Services OpenAI User on the Azure OpenAI resource.

```python
# cited_answer.py
# pip install "openai==2.32.0" "azure-search-documents==11.6.0" "azure-identity==1.25.3"
# Usage: python cited_answer.py "What is the notice period for contractors?"
import json
import re
import sys

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizableTextQuery
from openai import OpenAI
from pydantic import BaseModel

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
INDEX_NAME = "<your-index-name>"
SEMANTIC_CONFIG = "<your-semantic-config>"
VECTOR_FIELD = "<your-vector-field>"
OPENAI_BASE_URL = "https://<your-resource-name>.openai.azure.com/openai/v1/"
CHAT_DEPLOYMENT = "<your-chat-deployment>"
TOP = 5

credential = DefaultAzureCredential()
search = SearchClient(SEARCH_ENDPOINT, INDEX_NAME, credential)
llm = OpenAI(
    base_url=OPENAI_BASE_URL,
    api_key=get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default"),
)


class Claim(BaseModel):
    text: str
    source_ids: list[int]


class CitedAnswer(BaseModel):
    answered: bool
    claims: list[Claim]


SYSTEM = (
    "Answer only from the numbered sources. Write the answer as a list of claims, "
    "one sentence each. Every claim must list the numbers of the sources that directly "
    "state it. Do not cite a source for a claim it does not state. If the sources do "
    "not answer the question, set answered to false and return no claims."
)


def retrieve(question: str) -> dict[int, dict]:
    results = search.search(
        search_text=question,
        vector_queries=[
            VectorizableTextQuery(text=question, k_nearest_neighbors=50, fields=VECTOR_FIELD)
        ],
        query_type="semantic",
        semantic_configuration_name=SEMANTIC_CONFIG,
        query_caption="extractive|highlight-true",
        select=["chunk", "title", "url", "page", "last_modified"],
        top=TOP,
    )
    sources = {}
    for i, doc in enumerate(results, start=1):
        captions = doc.get("@search.captions") or []
        if captions:
            passage = captions[0].highlights or captions[0].text
        else:
            passage = doc["chunk"][:300]
        link = doc["url"] + (f"#page={doc['page']}" if doc.get("page") else "")
        sources[i] = {
            "chunk": doc["chunk"],
            "title": doc.get("title") or doc["url"],
            "link": link,
            "passage": passage,
            "last_modified": doc.get("last_modified"),
        }
    return sources


def generate(question: str, sources: dict[int, dict]) -> CitedAnswer:
    context = "\n\n".join(f"[{i}] {s['title']}\n{s['chunk']}" for i, s in sources.items())
    completion = llm.chat.completions.parse(
        model=CHAT_DEPLOYMENT,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Sources:\n{context}\n\nQuestion: {question}"},
        ],
        response_format=CitedAnswer,
    )
    message = completion.choices[0].message
    if message.refusal or message.parsed is None:
        return CitedAnswer(answered=False, claims=[])
    return message.parsed


def verify(
    answer: CitedAnswer, sources: dict[int, dict]
) -> tuple[list[Claim], list[str], dict[str, int]]:
    kept, dropped = [], []
    counts = {"claims": len(answer.claims), "ids_emitted": 0, "ids_valid": 0}
    for claim in answer.claims:
        ids = sorted({i for i in claim.source_ids if i in sources})
        counts["ids_emitted"] += len(claim.source_ids)
        counts["ids_valid"] += sum(1 for i in claim.source_ids if i in sources)
        if ids:
            kept.append(Claim(text=claim.text, source_ids=ids))
        else:
            dropped.append(claim.text)
    return kept, dropped, counts


def plain(passage: str) -> str:
    # Caption highlights wrap key phrases in <em> tags; show them as **bold** in a terminal.
    return re.sub(r"</?em>", "**", passage)


def render(claims: list[Claim], sources: dict[int, dict]) -> str:
    order: dict[int, int] = {}
    sentences = []
    for claim in claims:
        for i in claim.source_ids:
            order.setdefault(i, len(order) + 1)
        markers = "".join(f"[{n}]" for n in sorted(order[i] for i in claim.source_ids))
        sentences.append(f"{claim.text} {markers}")
    notes = []
    for original, shown in sorted(order.items(), key=lambda item: item[1]):
        s = sources[original]
        updated = f", updated {s['last_modified']}" if s["last_modified"] else ""
        notes.append(
            f"[{shown}] {s['title']} ({s['link']}){updated}\n"
            f"    \"{plain(s['passage'])}\""
        )
    return " ".join(sentences) + "\n\nSources:\n" + "\n".join(notes)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python cited_answer.py "<question>"', file=sys.stderr)
        sys.exit(1)
    question = sys.argv[1]
    sources = retrieve(question)
    answer = generate(question, sources)
    if not answer.answered or not answer.claims:
        stats = {"claims": 0, "ids_emitted": 0, "ids_valid": 0, "uncited": 0, "abstained": 1}
        print("citation_stats " + json.dumps(stats), file=sys.stderr)
        print("I couldn't find this in the indexed documents.")
        sys.exit(0)
    claims, dropped, counts = verify(answer, sources)
    stats = {**counts, "uncited": len(dropped), "abstained": 0}
    print("citation_stats " + json.dumps(stats), file=sys.stderr)
    if not claims:
        print("I couldn't find this in the indexed documents.")
        sys.exit(0)
    print(render(claims, sources))
    if dropped:
        print(f"\n[{len(dropped)} unsupported claim(s) removed]", file=sys.stderr)
```

A few design choices worth calling out. Only cited sources appear in the list, which removes padding. The numbering follows first use, so the reader sees `[1]` before `[2]`. Dropped claims go to logs, not the user, because a claim with no valid citation is exactly the kind of sentence you don't want shown. If dropping happens often for one document type, that's a chunking or prompt problem worth investigating, not something to hide.

What this code can't do is prove that source 3 actually *states* the claim it's attached to. ID validation catches invented pointers. It doesn't catch plausible but wrong pointers. That needs evaluation.

## Measure citations like you measure retrieval

I'd track three numbers per release, using the same labelled questions I described in [building eval sets from real user queries](/blog/2026-04-22-how-i-evaluate-llm-changes-building-eval-sets-from-real-user-queries/):

1. **Citation validity rate:** counted per citation, the share of all source IDs the model emitted that exist in the context. This is free, deterministic, and should be close to 100%. It's `ids_valid / ids_emitted` from the counts `verify` returns, summed across the eval set. A drop after a model or prompt change is an early warning that the model is inventing pointers.
2. **Citation support rate:** for each claim and cited source pair, does the source state the claim? Score a sample by hand first, then use an LLM judge on claim and source pairs once its verdicts agree with yours. My rule of thumb: label 50 to 100 claim/source pairs yourself and only switch to the judge once it agrees with you on roughly 90% of them, then re-check a small sample after each judge or model change. Judge the pair, not the whole answer, or you're back to measuring groundedness.
3. **Uncited claim rate:** counted per claim, the share of claims left with no surviving source ID, which is what `verify` drops: `uncited / claims` from the same logged JSON line. A model can have high validity and still a high uncited rate by citing nothing at all. High numbers mean the model is drawing on its own knowledge, which is the failure that citations exist to expose.

Track the abstention rate next to those three: the share of questions where the model set `answered` to false, which the script logs as `"abstained": 1` in the same JSON line. A model can push the uncited claim rate down just by refusing more often, so a falling uncited rate only counts as progress if abstentions on answerable questions didn't rise with it.

In production, citation clicks and passage expands are a useful signal, but a weak one. Low clicks can mean people trust the answer or that they gave up on the links. I'd only read them alongside a feedback control on the answer itself.

## When this is overkill

Not every RAG app needs claim-level citations.

- **Single-source assistants**, such as a bot over one product manual, can link the section once at the end. Per-sentence markers add noise.
- **Drafting and summarising tools**, where the output is a starting point that a person rewrites, need a source list, not a verified pointer for each sentence.
- **Latency-critical chat** may not tolerate waiting for the full structured response. If streaming the first words fast matters more than verifiable claims, use inline markers, validate them after the stream finishes, and grey out any that fail.

The cost of the structured approach is real: slower first output, a longer prompt, and a renderer that is your code to own. For questions where someone will act on the answer, I think that cost is worth paying every time.

## The rule I'd adopt

No citation, no claim. If a sentence can't point at a specific, existing passage that a reader can see without opening the whole document, it doesn't get shown. Build the page and section fields into your chunks now, use captions for the evidence, keep the model's job to choosing integers, and put citation validity and support next to recall on your release dashboard. The [RAG solution design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) covers the retrieval side well. Treat citations as the last step of that same pipeline, not as a formatting task for the front-end team.
