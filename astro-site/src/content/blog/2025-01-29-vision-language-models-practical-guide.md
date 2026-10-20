---
title: "Reading Charts and Dashboards with GPT-4o: What to Trust"
description: "Where GPT-4o vision helps data teams read charts and dashboard screenshots, what it gets wrong, what each image costs, and how to check its numbers in code."
author: Michael John Peña
draft: false
date: 2025-01-29
tags:
  - Azure OpenAI
  - GPT-4o
  - Computer Vision
  - Structured Output
  - Business Intelligence
  - AI
---

Data teams keep receiving numbers as pictures: a vendor's PDF report, a screenshot of a dashboard from a system nobody has API access to, a chart pasted into a board pack. GPT-4o can read those images, and it reads them well enough that people start trusting it with figures. That trust needs limits, because a vision model will give you a confident, nicely formatted number that it estimated from the height of a bar. The useful questions are when vision belongs in a data workflow at all, what an image costs, and how to get numbers out of a chart that you can actually check.

## First question: do you already have the data?

The most common mistake I see with vision models in analytics is pointing them at a screenshot of your own dashboard. If the chart came from a Power BI semantic model or a warehouse you control, query the source. A screenshot throws away precision, filter context and lineage, then asks a model to guess them back. That's slower, dearer and less accurate than a DAX or SQL query, every time.

Vision earns its place when the image is the only artefact you have:

- Reports from third parties that arrive as PDFs or images, with no data feed.
- Screenshots from legacy or SaaS systems where an export isn't on offer.
- Historical decks and scanned reports you want to bring into a dataset once.
- Reviewing your own rendered output, such as checking that a paginated report shows the sections and totals it should.

If your situation isn't on that list, I'd push back before building anything.

## What GPT-4o reads well, and what it doesn't

GPT-4o is a general multimodal model, not a chart parser. It's very good at reading text it can see clearly, and noticeably weaker at anything that requires measuring.

| Task | How far I'd trust it | Why |
|---|---|---|
| Printed KPI tiles and data labels | High | It's reading text, which it does well |
| Titles, axis labels, legends, time periods | High | Same reason |
| Describing a trend ("revenue fell through Q3") | Medium to high | Fine for a summary, not for reporting |
| Values estimated from bar heights or line positions | Low | It interpolates against the axis and rounds; errors are silent |
| Many thin series, similar colours, dense small text | Low | Series get swapped or merged, especially after downscaling |
| Counting many small marks (scatter points, map pins) | Low | Counts come back approximate |

The column that matters is the middle one. A value printed as a data label is a transcription problem, and GPT-4o is a strong transcriber. A value read off an axis is a measurement problem, and the model will happily produce a number to two decimal places without any basis for that precision. Your pipeline needs to know which kind of value it's holding.

## What an image costs

On Azure OpenAI, image input is billed as tokens, and the `detail` setting decides how many. The [Azure OpenAI vision documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/gpt-with-vision) describes the calculation for GPT-4o:

- **`low`**: a flat 85 tokens, whatever the image size. The model sees a heavily downscaled version.
- **`high`**: the image is scaled to fit inside 2048 x 2048, then scaled so its shortest side is 768 pixels. It's cut into 512 x 512 tiles, each costing 170 tokens, plus a base of 85.
- **`auto`** (the default): the service chooses.

A 1920 x 1080 dashboard screenshot at `high` becomes 1365 x 768, which is three tiles across and two down: 6 x 170 + 85 = 1,105 tokens. At `low` it's 85 tokens, but the 768-pixel rescale has already shrunk small labels at `high`, and at `low` most of them are unreadable.

My rule: use `low` for "what kind of chart is this, and what's it about" triage, and `high` for anything where you want numbers. If a dashboard has many small tiles, crop it into regions before sending. Several tight crops at `high` often cost more tokens than one full screenshot (each crop is billed 85 + 170 per 512-pixel tile after the rescale, and a small crop may be only one or two tiles), but the text in each crop survives the rescale, and that's what you're paying for.

## Get numbers back in a shape you can check

Asking for JSON in the prompt ("return JSON like this…") is fragile: the model can drop fields, add commentary or produce invalid JSON. Azure OpenAI now supports [structured outputs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs), which constrain the response to a JSON schema. It was added in API version `2024-08-01-preview`, is available in the `2024-10-21` GA API, and works with `gpt-4o` versions `2024-08-06` and `2024-11-20` (and `gpt-4o-mini` `2024-07-18`). The `openai` Python package (1.40 and later) can take a Pydantic model as the schema and parse the response for you.

The schema is where you encode the trust question. I ask the model to say, for every value, whether it was printed on the chart or estimated from the axis:

```python
import base64
import mimetypes
import os
from typing import Literal, Optional

from openai import AzureOpenAI
from pydantic import BaseModel

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com/
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-10-21",
)
DEPLOYMENT = "<your-gpt-4o-deployment>"  # gpt-4o, model version 2024-08-06 or 2024-11-20


class DataPoint(BaseModel):
    series: str
    category: str  # x-axis label, e.g. "Mar 2024"
    value: float
    source: Literal["data_label", "estimated_from_axis"]


class ChartExtraction(BaseModel):
    chart_type: str
    title: Optional[str]
    unit: Optional[str]  # e.g. "AUD thousands", "%"
    printed_total: Optional[float]  # only if a total is shown on the image
    total_series: Optional[str]  # series the total belongs to; None if it covers every point
    points: list[DataPoint]
    caveats: list[str]


def to_data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


def extract_chart(path: str) -> ChartExtraction:
    completion = client.beta.chat.completions.parse(
        model=DEPLOYMENT,
        temperature=0,
        response_format=ChartExtraction,
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract data from chart images. Report only what is visible. "
                    "Mark a value as data_label only if the number is printed on the chart; "
                    "otherwise mark it estimated_from_axis. Never invent series or categories. "
                    "If a total is printed (as a label or as its own bar), put it in printed_total, "
                    "not in points, and set total_series to the series it belongs to, or null if "
                    "it covers every point. "
                    "List anything unreadable or ambiguous in caveats."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract every data point from this chart."},
                    {"type": "image_url", "image_url": {"url": to_data_url(path), "detail": "high"}},
                ],
            },
        ],
    )
    message = completion.choices[0].message
    if message.refusal:
        raise ValueError(f"Model refused: {message.refusal}")
    return message.parsed
```

Structured outputs guarantees the *shape*. It does nothing for the *values*. A schema-valid response can still contain a misread number, so the next step matters more than the prompt.

## Check the model with boring code

Treat the extraction as a draft from a fast, slightly careless junior analyst. You wouldn't publish their numbers without a reconciliation, and the same applies here:

```python
def review(extraction: ChartExtraction, tolerance: float = 0.01) -> list[str]:
    issues = list(extraction.caveats)

    estimated = [p for p in extraction.points if p.source == "estimated_from_axis"]
    if estimated:
        issues.append(f"{len(estimated)} of {len(extraction.points)} values were estimated from the axis")

    if extraction.printed_total is not None:
        in_scope = [
            p for p in extraction.points
            if extraction.total_series is None or p.series == extraction.total_series
        ]
        total = sum(p.value for p in in_scope)
        if abs(total - extraction.printed_total) > abs(extraction.printed_total) * tolerance:
            issues.append(f"Points sum to {total:,.2f} but the chart shows {extraction.printed_total:,.2f}")

    keys = [(p.series, p.category) for p in extraction.points]
    if len(keys) != len(set(keys)):
        issues.append("Duplicate series/category pairs: series may have been confused")

    return issues


result = extract_chart("<path-to-chart>.png")
for issue in review(result):
    print("REVIEW:", issue)
```

The checks are deliberately dull. The total check sums only the series the printed total belongs to, which is why the schema asks for `total_series` and tells the model to keep a total bar out of `points`; if the model gets that attribution wrong, you'll see a false mismatch, which is the safe direction to fail. A printed total that doesn't reconcile is the best signal you'll get that a value was misread, and the `source` flag lets you route anything estimated to a person instead of a table. If every value on a chart is estimated, I'd store the result as "approximate, from image" or not store it at all.

Two more habits that pay off:

- **Compare in code, not in the prompt.** Sending two dashboard screenshots and asking "what changed?" produces a plausible narrative that's hard to verify. Extract each image separately into the same schema, then diff the two results in pandas. The diff is deterministic, and you can see exactly which values moved.
- **Keep the image with the output.** Store the source image path or hash next to every extracted row. When someone questions a figure in three months, the evidence is one click away.

## When not to use a vision model for this

- **You own the data.** Covered above, but it's the case I see most, so it's worth repeating.
- **Dense tables, forms and invoices.** Use [Azure AI Document Intelligence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview) instead. Its layout and prebuilt models return text and table cells with bounding boxes and confidence scores, which a general model doesn't. For PDFs that mix tables with charts, I'd run Document Intelligence first and send only the figures to GPT-4o. I covered that split in [Multimodal RAG on Azure: Caption PDF Figures Before You Embed Them](/blog/2025-01-28-multimodal-rag-implementation/).
- **Figures that go into regulatory or financial reporting.** An estimated value with no audit trail doesn't belong there, however good the model is.
- **High-volume, fixed-format images.** If you're processing thousands of the same report layout, a template or a document model is cheaper and more predictable than paying around 1,100 tokens per screenshot for a model to rediscover the layout every time.
- **Screenshots containing personal data.** Dashboards often show customer names or account numbers. Crop them out or keep the processing inside the controls you'd apply to the source system.

## The short version

GPT-4o is a reliable reader of text on an image and an unreliable ruler. Use it on images you can't get the data behind, send `high` detail (cropped if the image is busy) when you want numbers, and use structured outputs so every value arrives labelled as printed or estimated. Then reconcile against whatever the image itself tells you, keep the image as evidence, and send anything estimated to a person. If you need a schema-first pattern for other GPT-4o tasks, the same approach drives [Drafting a Star Schema with GPT-4o and Structured Outputs](/blog/2025-01-20-ai-assisted-data-modeling/).
