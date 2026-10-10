---
title: "Multimodal RAG on Azure: Caption PDF Figures Before You Embed Them"
description: "Make diagrams and charts in PDFs retrievable with Document Intelligence 4.0 figure extraction, GPT-4o descriptions and Azure AI Search hybrid queries."
author: Michael John Peña
draft: false
date: 2025-01-28
tags:
  - RAG
  - Multimodal
  - Document Intelligence
  - Azure AI Search
  - Azure OpenAI
  - GPT-4o
---

Most enterprise RAG pipelines quietly throw away the most useful part of a technical document. The architecture diagram, the process flow and the chart that explains last quarter's numbers all pass through OCR as a handful of stray labels, so the retriever never finds them and the model never sees them. If your corpus is design documents, engineering manuals or board packs, that gap is often the reason users say the assistant "doesn't know" things that are plainly in the source.

As of January 2025 the Azure pieces needed to close that gap are all generally available. The pipeline I'd build first is below, and it hinges on one design decision: whether a figure becomes searchable through a text description or through an image embedding.

## Two ways to make a figure retrievable

There are two honest options for getting an image into a vector index.

**Verbalise it.** Send the figure to a vision-capable model such as [GPT-4o](/blog/2024-05-15-gpt4o-omni-multimodal-ai/), ask for a description written for search, then embed that description with the same text embedding model you use for everything else. The figure becomes a text chunk with a pointer back to the image.

**Embed the pixels.** Use a model that puts images and text in the same vector space. On Azure that's the [Azure AI Vision multimodal embeddings API](https://learn.microsoft.com/azure/ai-services/computer-vision/how-to/image-retrieval), which went GA with API version `2024-02-01` (model version `2023-04-15`, multilingual text queries). You vectorise the image directly and vectorise the user's query with the matching text endpoint.

| | GPT-4o description + text embedding | AI Vision multimodal embeddings |
|---|---|---|
| What the query matches | Concepts the model wrote down, including text inside the image | Semantic similarity between the query text and the image content (objects, scenes), not the text or labels inside it |
| Works with your existing text index | Yes, same vector field and model | Needs a separate vector field and a separate query vectoriser |
| Good at | Diagrams, charts, screenshots, annotated drawings | Photos, product images, "find images that look like this" |
| Weak at | Purely visual similarity; cost scales with figure count | Dense technical diagrams where meaning lives in labels and arrows |
| Ingestion cost | One vision chat call per figure | One cheap vectorise call per figure |
| Explainability | You can read and correct the description | A 1,024-dimension vector you can't inspect |

My default for document-heavy corpora is to verbalise. Questions about a technical diagram are almost always questions about its *meaning* ("which service writes to the landing zone?"), and that meaning lives in labels, arrows and the surrounding paragraph. A description captures that; a pixel embedding mostly doesn't. Descriptions also land in the same index, with the same embedding model and the same hybrid ranking as your text chunks, so you get one retrieval path instead of two that need fusing.

Image embeddings earn their place when users search by appearance: a parts catalogue, site inspection photos, retail imagery. If that's your corpus, the multimodal embeddings API is the better primary tool, and you'd add descriptions later for the minority of images that carry text.

## The pipeline

Four steps, all on GA services:

1. **Extract** text and figures with [Document Intelligence v4.0](https://learn.microsoft.com/azure/ai-services/document-intelligence/whats-new) (API `2024-11-30`, GA since late November 2024). The layout model now returns figures with their captions and bounding regions, and with `output=figures` it also produces a cropped PNG of each one.
2. **Describe** each figure with GPT-4o on Azure OpenAI, grounding the prompt with the figure's caption and the text on the same page.
3. **Index** text chunks and figure descriptions in one Azure AI Search index, with a `content_type` field so you can filter or boost.
4. **Answer** with hybrid retrieval, and decide per query whether to send the image itself back to the model.

The code below uses `azure-ai-documentintelligence` 1.0.0 (GA in December 2024), `azure-search-documents` 11.5.2 and `openai` 1.60, with Entra ID authentication everywhere. Install with `pip install azure-ai-documentintelligence==1.0.0 azure-search-documents==11.5.2 openai==1.60.1 azure-identity`. Before running this, enable role-based access on the search service (API access control: Role-based or Both) and assign Search Service Contributor plus Search Index Data Contributor on it, Cognitive Services User on the Document Intelligence resource, and Cognitive Services OpenAI User on the Azure OpenAI resource. New search services accept only API keys by default, so skipping this step gets you a 403.

The three blocks below form one module; run them in order.

### Extract and describe figures

```python
import base64
import hashlib
from pathlib import Path

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeOutputOption, AnalyzeResult
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

DI_ENDPOINT = "https://<your-doc-intelligence-resource>.cognitiveservices.azure.com/"
AOAI_ENDPOINT = "https://<your-openai-resource>.openai.azure.com/"
CHAT_DEPLOYMENT = "<your-gpt-4o-deployment>"
EMBED_DEPLOYMENT = "<your-text-embedding-3-large-deployment>"
FIGURE_DIR = Path("figures")

credential = DefaultAzureCredential()
di_client = DocumentIntelligenceClient(endpoint=DI_ENDPOINT, credential=credential)
aoai = AzureOpenAI(
    azure_endpoint=AOAI_ENDPOINT,
    azure_ad_token_provider=get_bearer_token_provider(
        credential, "https://cognitiveservices.azure.com/.default"
    ),
    api_version="2024-10-21",
    max_retries=5,  # backs off and retries on 429 throttling
)

DESCRIBE_PROMPT = """You are writing a search-index entry for a figure from a document.
Describe what the figure shows so someone searching in plain language can find it.
Name the figure type (architecture diagram, flowchart, bar chart, table image, photo).
List every component, label and number you can read, and state how components connect.
Do not guess at anything you cannot read. Context from the same page:
{context}"""


def make_id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:32]


def page_text(result: AnalyzeResult, page_number: int) -> str:
    paragraphs = result.paragraphs or []
    return "\n".join(
        p.content
        for p in paragraphs
        if p.bounding_regions and p.bounding_regions[0].page_number == page_number
    )


def describe_figure(png_bytes: bytes, context: str) -> str:
    image_b64 = base64.b64encode(png_bytes).decode("utf-8")
    response = aoai.chat.completions.create(
        model=CHAT_DEPLOYMENT,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": DESCRIBE_PROMPT.format(context=context[:2000])},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"},
                    },
                ],
            }
        ],
    )
    return response.choices[0].message.content


def extract_chunks(pdf_path: str) -> list[dict]:
    with open(pdf_path, "rb") as f:
        poller = di_client.begin_analyze_document(
            "prebuilt-layout", body=f, output=[AnalyzeOutputOption.FIGURES]
        )
    result: AnalyzeResult = poller.result()
    operation_id = poller.details["operation_id"]
    FIGURE_DIR.mkdir(exist_ok=True)

    chunks = []
    for page in result.pages:
        text = page_text(result, page.page_number)
        if text.strip():
            chunks.append({
                "id": make_id(pdf_path, "page", str(page.page_number)),
                "content_type": "text",
                "source": pdf_path,
                "page": page.page_number,
                "content": text,
                "figure_path": None,
            })

    for figure in result.figures or []:
        if not figure.id or not figure.bounding_regions:
            continue
        page_number = figure.bounding_regions[0].page_number
        png_bytes = b"".join(
            di_client.get_analyze_result_figure(
                model_id=result.model_id, result_id=operation_id, figure_id=figure.id
            )
        )
        figure_path = FIGURE_DIR / f"{Path(pdf_path).stem}-{figure.id}.png"
        figure_path.write_bytes(png_bytes)

        caption = figure.caption.content if figure.caption else ""
        context = f"Caption: {caption}\n{page_text(result, page_number)}"
        description = describe_figure(png_bytes, context)
        chunks.append({
            "id": make_id(pdf_path, "figure", figure.id),
            "content_type": "figure",
            "source": pdf_path,
            "page": page_number,
            "content": f"{caption}\n{description}".strip(),
            "figure_path": str(figure_path),
        })
    return chunks
```

Two details in that code matter more than they look. First, the prompt includes the caption and the page's text. A diagram labelled "Figure 3" with boxes called "Svc A" and "Svc B" means nothing on its own; the paragraph next to it usually says what A and B are. Second, `temperature=0` and the instruction not to guess. A description that invents a component is worse than no description, because it will be retrieved confidently and cited.

Page-level text chunks are deliberately crude here so the figure handling stays visible. In production I'd chunk on the section structure Document Intelligence returns (or its Markdown output) rather than whole pages.

### Index text and figures together

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
    SearchableField,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
INDEX_NAME = "docs-multimodal"


def embed(text: str) -> list[float]:
    return aoai.embeddings.create(model=EMBED_DEPLOYMENT, input=[text]).data[0].embedding


def create_index() -> None:
    index = SearchIndex(
        name=INDEX_NAME,
        fields=[
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SimpleField(name="content_type", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="source", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="page", type=SearchFieldDataType.Int32, filterable=True),
            SimpleField(name="figure_path", type=SearchFieldDataType.String),
            SearchableField(name="content", type=SearchFieldDataType.String),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=3072,
                vector_search_profile_name="default-profile",
            ),
        ],
        vector_search=VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
            profiles=[VectorSearchProfile(name="default-profile", algorithm_configuration_name="hnsw")],
        ),
    )
    SearchIndexClient(SEARCH_ENDPOINT, credential).create_or_update_index(index)


def index_pdf(pdf_path: str) -> None:
    chunks = extract_chunks(pdf_path)
    for chunk in chunks:
        chunk["content_vector"] = embed(chunk["content"])
    search = SearchClient(SEARCH_ENDPOINT, INDEX_NAME, credential)
    # A request is capped at 1,000 documents and 16 MB; a 3,072-dimension vector is ~50-60 KB of JSON.
    for i in range(0, len(chunks), 100):
        results = search.upload_documents(chunks[i : i + 100])
        failed = [r.key for r in results if not r.succeeded]
        if failed:
            raise RuntimeError(f"{len(failed)} documents failed to index: {failed[:5]}")
```

One index, one embedding model, one vector field. The upload is batched because Azure AI Search caps an indexing request at 1,000 documents and 16 MB, and with 3,072-dimension vectors a few hundred chunks blow through the size limit and return 413. `upload_documents` also doesn't raise when an individual document fails, so check each result's `succeeded` flag. For large or continuous loads, `SearchIndexingBufferedSender` handles batching and retries for you. If you're also adding semantic ranking or query rewriting on top of this, the patterns in [RAG 2.0](/blog/2025-01-17-rag-2-0-advanced-retrieval-patterns/) apply unchanged. The `content_type` filter lets you answer "show me the diagram for…" queries with figures only, and lets you measure whether figure chunks are actually being retrieved.

### Retrieve, then decide whether to show the model the image

```python
from azure.search.documents.models import VectorizedQuery


def answer(question: str) -> dict:
    search = SearchClient(SEARCH_ENDPOINT, INDEX_NAME, credential)
    results = list(search.search(
        search_text=question,
        vector_queries=[VectorizedQuery(
            vector=embed(question), k_nearest_neighbors=10, fields="content_vector"
        )],
        select=["content_type", "source", "page", "content", "figure_path"],
        top=5,
    ))

    parts = [{"type": "text", "text": f"Question: {question}\n\nSources:"}]
    for i, r in enumerate(results, start=1):
        parts.append({"type": "text", "text": f"[{i}] {r['source']} p.{r['page']}\n{r['content']}"})
        if r["content_type"] == "figure":
            image_b64 = base64.b64encode(Path(r["figure_path"]).read_bytes()).decode("utf-8")
            parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "low"},
            })

    response = aoai.chat.completions.create(
        model=CHAT_DEPLOYMENT,
        temperature=0,
        messages=[
            {"role": "system", "content": "Answer only from the numbered sources and cite them like [2]. "
                                          "If the sources do not contain the answer, say so."},
            {"role": "user", "content": parts},
        ],
    )
    return {
        "answer": response.choices[0].message.content,
        "figures": [r["figure_path"] for r in results if r["content_type"] == "figure"],
    }
```

Retrieval runs entirely on the description, but at answer time the retrieved figure goes back to GPT-4o. That second look is what lets the model answer questions the description didn't anticipate. It costs tokens: the [`detail` setting](https://learn.microsoft.com/azure/foundry/openai/how-to/gpt-with-vision#configure-image-detail-level) decides how many. A `low` detail image is a single 512x512 pass at a flat 85 tokens, while `high` adds 170 tokens per 512-pixel tile. I use `low` at answer time and `high` at ingestion, where the description has to capture small labels. If your figures are dense engineering drawings, test `high` at answer time too and accept the cost.

Return the figure paths to your UI as well. Showing users the actual diagram next to the answer is the cheapest trust-builder in a multimodal assistant.

## What's still preview, and what I'd avoid

Azure AI Search can do parts of this for you without custom code, but the relevant pieces were preview at the end of January 2025. The [AI Vision multimodal embeddings skill](https://learn.microsoft.com/azure/search/cognitive-search-skill-vision-vectorize) and matching vectoriser arrived in the `2024-05-01-preview` API, and the Document Layout skill in `2024-11-01-preview`. Azure AI Content Understanding, announced at Ignite in November 2024, is also in public preview and targets this extraction problem directly. All three are worth a spike. I wouldn't put a preview API on the ingestion path for a production corpus yet; a custom pipeline on GA SDKs is easy to swap out later.

The other thing I'd avoid is describing every image. Logos, decorative headers and signature blocks generate descriptions that pollute retrieval and cost a vision call each. Filter on figure size, or skip figures with no caption and no nearby text, before calling GPT-4o.

To size ingestion, use the same token rule. A 1024x1024 figure at `high` detail is scaled to 768x768, which is four tiles: 85 + 4 x 170 = 765 input tokens for the image, plus a few hundred for the prompt and page context, and around 300 output tokens for the description. Multiply by your figure count and you have a defensible estimate before you run anything. Throughput is the other constraint: describing a large corpus with sequential GPT-4o calls will hit 429s against your deployment's tokens-per-minute quota. The client above retries with backoff, but for a backfill of thousands of figures I'd send the descriptions through an Azure OpenAI global batch deployment instead and accept results within the 24-hour window.

## When not to bother

Multimodal RAG adds a vision call per figure, a second artefact store and a harder evaluation problem. Skip it when:

- Your documents are mostly prose and tables. Document Intelligence already turns tables into structured text; that alone fixes most "the bot can't read our PDFs" complaints.
- The figures restate what the text already says. Many policy and procedure documents are like this.
- You can't evaluate it. Build a question set where the answer is only in a figure, and measure whether figure chunks appear in the top five. Without that, you won't know if the descriptions are helping or adding noise.

## The decision in short

For document corpora, caption first: extract figures with Document Intelligence 4.0, describe them with GPT-4o using the surrounding text as grounding, and index the descriptions next to your text chunks in Azure AI Search. Add AI Vision image embeddings only when users genuinely search by appearance. Keep the preview Search skills and Content Understanding on your radar, and revisit the build-versus-configure question when they reach GA.
