---
title: "Structure-Aware Chunking for RAG: Headings, Tables and Breadcrumbs"
description: "Chunk documents along their headings, keep tables whole and prefix every chunk with its section path, using Document Intelligence markdown output and Python."
author: Michael John Peña
draft: false
date: 2024-01-07
tags:
  - RAG
  - Chunking
  - Document Intelligence
  - Azure AI Search
  - Python
---

My rule of thumb: fix chunking before you swap models; it usually moves retrieval quality more. Yet most pipelines still cut documents every N characters, slicing tables in half and stranding paragraphs from the headings that explain what they're about. A chunk that says "the limit is 30 days" is useless if the retriever can't tell whether it came from the refund policy or the leave policy. This post is about fixing that by chunking along the structure the author already gave the document.

I covered the menu of options (fixed-size, recursive, semantic) in [Document Chunking Strategies for RAG Systems](/blog/2023-10-26-chunking-strategies/). Here I want to go deeper on the one I now default to for business documents: structure-aware chunking with breadcrumbs.

## Why fixed-size splits fail on real documents

Policies, manuals, contracts and runbooks aren't streams of prose. They're trees: a title, sections, subsections, lists, tables. Fixed-size chunking ignores the tree, and three things go wrong.

- **Context is lost at the boundary.** The heading "Refunds > Digital products" sits in one chunk and the rule sits in the next. The rule's embedding no longer carries the word "refund" at all.
- **Tables get cut mid-row.** Half a pricing table with no header row is noise to an embedding model and dangerous context for an LLM, which will happily read the wrong column.
- **Overlap papers over the problem.** Adding 10–20% overlap is the usual fix. It costs index size and tokens, produces near-duplicate search results, and still doesn't guarantee the heading lands in the same chunk as the rule.

Semantic chunking (splitting where the embedding similarity between neighbouring sentences drops) is the other popular answer. It's clever, but it needs an embedding for every sentence at ingestion time (batched, but still far more vectors than you'll store), its threshold is a magic number you'll tune per corpus, and it ignores the explicit signal the author left behind. When a document has headings, I'd rather trust the headings.

## Step one: get the structure out of the file

Structure-aware chunking only works if you can see the structure. Plain-text extraction from a PDF flattens it: headings become ordinary lines and tables become columns of words. That was the main obstacle until recently.

In November 2023, Azure AI Document Intelligence (renamed from Form Recognizer) shipped the `2023-10-31-preview` API, and its `prebuilt-layout` model can now return the document as **Markdown**, with headings, paragraphs and tables marked up ([What's new in Document Intelligence](https://learn.microsoft.com/azure/ai-services/document-intelligence/whats-new)). The new `azure-ai-documentintelligence` Python package, first released as 1.0.0b1 on 17 November 2023, targets that API version ([changelog](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/documentintelligence/azure-ai-documentintelligence/CHANGELOG.md)). Both are preview, so pin the package version and expect breaking changes before GA.

```python
# pip install azure-ai-documentintelligence==1.0.0b1
import os

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import ContentFormat
from azure.core.credentials import AzureKeyCredential

client = DocumentIntelligenceClient(
    endpoint=os.environ["DOCUMENTINTELLIGENCE_ENDPOINT"],  # https://<your-resource-name>.cognitiveservices.azure.com/
    credential=AzureKeyCredential(os.environ["DOCUMENTINTELLIGENCE_API_KEY"]),
)

with open("leave-policy.pdf", "rb") as f:
    poller = client.begin_analyze_document(
        "prebuilt-layout",
        analyze_request=f,
        content_type="application/octet-stream",
        output_content_format=ContentFormat.MARKDOWN,
    )

markdown = poller.result().content

with open("leave-policy.md", "w", encoding="utf-8") as out:
    out.write(markdown)
```

If your sources are already Markdown, HTML or Word with proper heading styles, you can skip this and convert directly. The point is to reach a text format where headings and tables are explicit.

## Step two: chunk along the tree

The chunker below makes three decisions, and they're the substance of this approach:

1. **A chunk never crosses a heading.** Each section is packed on its own, so a chunk is always about one thing.
2. **A table is never split.** Blocks are separated by blank lines, so a pipe table stays in one block, and an HTML `<table>` is collected whole even if it contains blank lines.
3. **Every chunk carries its breadcrumb.** The heading path ("Leave Policy > Parental leave > Eligibility") is prefixed to the chunk text, so it's embedded and sent to the LLM with the content.

Size is measured in tokens with `tiktoken` and the `cl100k_base` encoding used by `text-embedding-ada-002`, not in characters. Character counts drift badly on tables, numbers and non-English text.

```python
# pip install tiktoken
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import tiktoken

ENCODING = tiktoken.get_encoding("cl100k_base")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def n_tokens(text: str) -> int:
    return len(ENCODING.encode(text))


@dataclass
class Chunk:
    breadcrumb: str
    body: str
    metadata: dict = field(default_factory=dict)

    @property
    def text(self) -> str:
        return f"{self.breadcrumb}\n\n{self.body}"


def split_blocks(lines: list[str]) -> list[str]:
    """Group lines into blocks separated by blank lines; keep HTML tables whole."""
    blocks: list[str] = []
    current: list[str] = []
    in_table = False
    for line in lines:
        if not in_table and "<table" in line:
            if current:
                blocks.append("\n".join(current))
                current = []
            in_table = True
        if in_table:
            current.append(line)
            if "</table>" in line:
                blocks.append("\n".join(current))
                current = []
                in_table = False
            continue
        if line.strip():
            current.append(line)
        elif current:
            blocks.append("\n".join(current))
            current = []
    if current:
        blocks.append("\n".join(current))
    return blocks


def pack(path: list[str], blocks: list[str], max_tokens: int, doc_title: str) -> list[Chunk]:
    """Pack whole blocks into chunks that fit the token budget, breadcrumb included."""
    breadcrumb = " > ".join(path) if path else doc_title  # text before the first heading
    budget = max_tokens - n_tokens(breadcrumb) - 2
    chunks: list[Chunk] = []
    current: list[str] = []
    for block in blocks:
        if current and n_tokens("\n\n".join(current + [block])) > budget:
            chunks.append(Chunk(breadcrumb, "\n\n".join(current)))
            current = []
        current.append(block)
    if current:
        chunks.append(Chunk(breadcrumb, "\n\n".join(current)))
    for chunk in chunks:
        chunk.metadata = {
            "section_path": breadcrumb,
            "tokens": n_tokens(chunk.text),
            "oversized": n_tokens(chunk.text) > max_tokens,
        }
    return chunks


def chunk_markdown(markdown: str, doc_title: str, max_tokens: int = 512) -> list[Chunk]:
    path: list[str] = []
    section_lines: list[str] = []
    chunks: list[Chunk] = []

    def flush() -> None:
        blocks = split_blocks(section_lines)
        if blocks:
            chunks.extend(pack(path, blocks, max_tokens, doc_title))
        section_lines.clear()

    for line in markdown.splitlines():
        if line.strip().startswith("<!--"):
            continue  # skip single-line HTML comments such as page markers
        match = HEADING.match(line)
        if match:
            flush()
            level = len(match.group(1))
            path = path[: level - 1] + [match.group(2)]
        else:
            section_lines.append(line)
    flush()
    return chunks


if __name__ == "__main__":
    source = Path(sys.argv[1])
    with source.open(encoding="utf-8") as f:
        for i, chunk in enumerate(chunk_markdown(f.read(), doc_title=source.stem)):
            print(f"--- chunk {i} {chunk.metadata}")
            print(chunk.text)
```

Run it with `python chunker.py leave-policy.md` and read the output before you embed anything. Text that appears before the first heading gets the document title (here the file name) as its breadcrumb, so it still embeds with useful context. The comment filter strips only single-line comments, such as Document Intelligence's `<!-- PageBreak -->` markers; a comment that spans lines would end up in a chunk. Reading twenty chunks by eye catches more problems than any metric.

### What the code deliberately doesn't do

**No overlap.** Overlap exists to compensate for arbitrary boundaries. Once boundaries follow headings and every chunk carries its section path, overlap mostly adds duplicates. If a section is long enough to need several chunks and the paragraphs genuinely depend on each other, add overlap per section, not globally.

**No silent splitting of oversized blocks.** A table bigger than the budget comes out as one chunk flagged `oversized`. I'd rather see those and decide: split by rows and repeat the header rows in each piece, summarise the table into prose for retrieval while keeping the original for the answer, or raise the budget for that document type. Splitting a table blindly is exactly the failure this approach exists to avoid.

**No merging of tiny sections.** A section with a single sentence becomes a small chunk. That's usually fine, because the breadcrumb gives it enough context to embed well. If your documents have dozens of one-line sections, merge siblings under their parent heading.

## Embedding the breadcrumb, not just the body

The breadcrumb is embedded with the chunk on purpose. A user asking "who is eligible for parental leave?" should match a chunk whose body only says "Eligible after 12 months of continuous service", because its breadcrumb says "Parental leave > Eligibility". Keep `section_path` as a separate filterable, retrievable field in your index too, so you can show citations and filter by section.

```python
# pip install openai==1.6.1
import os

from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com/
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-05-15",
)


def embed(texts: list[str], deployment: str = "<your-ada-002-deployment>") -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), 16):  # Azure OpenAI caps ada-002 (version 2) at 16 inputs per request
        response = client.embeddings.create(model=deployment, input=texts[start : start + 16])
        vectors.extend(item.embedding for item in response.data)
    return vectors
```

Azure OpenAI's `text-embedding-ada-002` (version 2) accepts up to 16 inputs per request and 8,191 input tokens per input ([quotas and limits](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits)); version 1 takes only one input per request. The token limit is a ceiling, not a target. A 512-token chunk embeds one idea; a 4,000-token chunk embeds the average of twenty, and retrieval precision falls with it. I start at 512 and only go higher for documents with long, tightly coupled sections such as legal clauses.

## Where Azure AI Search fits

Azure AI Search (renamed from Azure Cognitive Search in November 2023) now has integrated vectorization in public preview, which chunks with the [Text Split skill](https://learn.microsoft.com/azure/search/cognitive-search-skill-textsplit) and embeds with an Azure OpenAI skill inside the indexer ([integrated vectorization](https://learn.microsoft.com/azure/search/vector-search-integrated-vectorization)). It's the fastest way to get a vector index running over blob storage, and for homogeneous prose it's good enough.

The Text Split skill splits by pages or sentences with a maximum length and, in the `2023-10-01-preview` API, optional page overlap. It doesn't know about headings or tables. So my rule of thumb is:

| Situation | What I'd use |
|---|---|
| Mostly prose, few headings, need a prototype this week | Integrated vectorization with Text Split |
| Structured business documents with headings and tables | Custom chunking (as above), push chunks to the index |
| Same, but you want the indexer to own the pipeline | Wrap the chunker in a custom Web API skill |
| Transcripts, chat logs, scraped pages with no reliable structure | Sentence-aware or semantic chunking |

## When not to bother

Structure-aware chunking depends on the structure being real. If your PDFs are scans of letters, if headings are just bold text that the layout model doesn't classify as headings, or if every document is a single wall of text, the breadcrumb will be empty and you'll gain nothing over a sentence-aware splitter. Check a sample of Document Intelligence output first: if the Markdown has few `#` lines, choose a different strategy.

It's also more code to own. A heading regex, a table detector and a token budget are simple, but they're yours to maintain when a new source format turns up.

## The decision

If your corpus is manuals, policies, contracts or runbooks, chunk along the headings, keep tables whole and embed the section path with every chunk. Get the structure out with Document Intelligence's Markdown output (preview, so pin your versions), size chunks in tokens, and drop global overlap. Then build a small set of real questions with known answers and compare retrieval against your fixed-size baseline before you commit. Chunking is cheap to change before you've indexed a million documents and expensive after.
