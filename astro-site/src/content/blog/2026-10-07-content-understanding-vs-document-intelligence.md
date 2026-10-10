---
title: "Content Understanding vs Document Intelligence: Choose by Shape"
description: "Document Intelligence wins on fixed layouts, Content Understanding on variable or multimodal input: split the pipeline and leave stable extractors alone."
author: Michael John Peña
draft: false
date: 2026-10-07
tags:
  - Azure
  - Document Intelligence
  - Content Understanding
  - Microsoft Foundry
  - Document Processing
  - Architecture
---

Azure Content Understanding has been generally available since November 2025 with API version `2025-11-01`, and since then the obvious question for any team running Document Intelligence has been: do we move everything onto the new service? Microsoft's own guidance says no, and gives a rule simple enough to put on a whiteboard. Choose by the shape of the document, not by which service is newer. Teams that skip that step end up paying generative prices to re-extract invoices their existing models already handle well.

## What Microsoft actually recommends

The [Choose the right Foundry Tool for document processing](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/choosing-right-ai-tool) guide frames the two services as complementary parts of one offering. Document Intelligence models are "purposely trained for document parsing and extraction tasks" and are ideal for "structured documents with common templates where consistency, low latency, and proven accuracy are the priority". Content Understanding analysers are LLM-powered and are good at "unstructured documents, varying layouts, multimodal content, inferred fields, and complex reasoning scenarios", without labelled training data to get started.

The guide's quick-reference table, written against Content Understanding `2025-11-01` and Document Intelligence v4.0 (`2024-11-30`), boils down to this:

| Scenario | Recommended tool |
|---|---|
| OCR or layout only | Content Understanding `prebuilt-read` or `prebuilt-layout` |
| RAG preprocessing, images, audio, video | Content Understanding prebuilt or custom analysers |
| Standard structured forms (invoice, receipt, ID, tax, mortgage) | Document Intelligence prebuilt model |
| Contracts and legal agreements | Content Understanding `prebuilt-contract` |
| Custom fields without labels, or on unstructured documents | Content Understanding custom analyser |
| Custom fields on highly structured documents, with labels | Document Intelligence custom model |
| On-premises or air-gapped | Document Intelligence containers |

The companion Document Intelligence page, [Which model should I choose?](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/choose-model-feature), is even blunter. It positions Document Intelligence for "high-volume, deterministic extraction from structured and semi-structured documents" with low latency, and Content Understanding for complex, varied, unstructured or multimodal content with medium latency.

The line I'd highlight for anyone with a production system is in a callout box: if you already run Document Intelligence in production, "your APIs, endpoints, SDKs, and billing are unchanged. No migration is required." The guidance is aimed at new workloads and adjacent use cases.

## Document shape is the deciding variable

Volume, budget and team preference matter, but the first question is how much the layout varies and whether the field you want is written on the page.

**Fixed layout, explicit fields.** Onboarding forms, a bank's account opening application, a W-2. The same template every time, and every value you need sits in a predictable box. A trained model does this cheaply, quickly and the same way every time. Content Understanding can do it too, but you gain little from a language model reading a form whose answer is always in the same place. Microsoft's own scenario walkthrough actually suggests starting a new custom single-format form on a Content Understanding custom analyser, because it needs no labelling. I'd still train Document Intelligence once volume, latency or determinism dominate, because that's where the per-page cost and repeatability pay off.

**Many layouts, explicit fields.** Invoices from hundreds of suppliers, receipts from international chains, delivery notes. This is the contested middle. Document Intelligence prebuilts handle common types well, and a custom neural model can be trained from as few as five labelled samples per variant. Content Understanding's pitch here is zero-shot extraction: describe the field in plain language and let it generalise across templates. Microsoft's scenario walkthrough marks Content Understanding prebuilts as recommended even for a small set of known variants, and recommends Content Understanding for high-variation semi-structured documents. I agree when the long tail of layouts keeps growing. If you only need a handful of extra fields, try Document Intelligence's [query fields add-on](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/add-on-capabilities) first: no training, up to 20 fields per request, priced as a premium add-on. If your supplier list is stable and your existing model's accuracy is fine, it isn't a reason to switch.

**Unstructured documents and inferred fields.** Contracts, referral letters, policies, research reports. The value you want often isn't written down as a single string. The guide's example is deriving a contract end date from a start date and a duration. Document Intelligence has no generative path, so this is Content Understanding territory, or a custom LLM pipeline you would then have to build confidence scoring for yourself. Agentic mode (preview in `2026-06-01-preview` since July 2026) goes further for multistep calculations and validation, but keep it out of production until it reaches GA.

**Multimodal or multi-file.** Onboarding packages with PDFs, ID images and recorded interviews. Document Intelligence is documents only. Content Understanding has analysers for images, audio and video (multi-file input is still in preview).

## Split the pipeline by shape

Most real intake streams contain more than one of those shapes. A claims inbox has a standard claim form, a scanned invoice, a free-text doctor's letter and sometimes a phone recording. Forcing all of that through one service means either under-serving the messy documents or overpaying for the tidy ones.

The design I'd recommend is a classifier at the front and two extraction paths behind it:

1. **Classify and route.** Content Understanding analysers can classify with `contentCategories`, up to 200 categories in a single analyser at GA, and route each category to another analyser. Document Intelligence custom classifiers do the same job. Use whichever you already run; the routing decision is what matters.
2. **Deterministic path.** Fixed-layout types go to Document Intelligence prebuilt or custom models. These are your high-volume, latency-sensitive, repeatable extractions.
3. **Generative path.** Variable-layout, unstructured and multimodal types go to Content Understanding analysers, with confidence and grounding switched on.
4. **One review queue.** Both paths emit field, value, confidence and source location. Normalise them into one schema and apply thresholds per field, so reviewers see a single queue regardless of which engine produced the result.

A Content Understanding analyser for the generative path looks like this. The `generate` field asks the model to infer a value that isn't stated literally, and `estimateFieldSourceAndConfidence` asks for a confidence score and source grounding on every field:

```json
{
  "description": "Referral letter analyser",
  "baseAnalyzerId": "prebuilt-document",
  "models": {
    "completion": "gpt-5.2"
  },
  "config": {
    "returnDetails": true,
    "estimateFieldSourceAndConfidence": true
  },
  "fieldSchema": {
    "fields": {
      "PatientName": {
        "type": "string",
        "method": "extract",
        "description": "Full name of the patient being referred"
      },
      "ReferringClinician": {
        "type": "string",
        "method": "extract",
        "description": "Name of the clinician who wrote the letter"
      },
      "Urgency": {
        "type": "string",
        "method": "classify",
        "description": "How urgently the patient should be seen",
        "enum": ["routine", "soon", "urgent"]
      },
      "ReasonSummary": {
        "type": "string",
        "method": "generate",
        "description": "One-sentence summary of why the patient is being referred"
      }
    }
  }
}
```

You create it with a `PUT` to `{endpoint}/contentunderstanding/analyzers/{analyzerId}?api-version=2025-11-01`, as shown in the [custom analyser tutorial](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/tutorial/create-custom-analyzer). The review split behind both paths is plain code. This fragment assumes you have already mapped each service's response into a list of `(name, value, confidence)` tuples:

```python
# Fragment: per-field thresholds applied to results from either service.
THRESHOLDS = {
    "PatientName": 0.90,
    "ReferringClinician": 0.85,
    "Urgency": 0.80,
    "ReasonSummary": 0.70,
}
DEFAULT_THRESHOLD = 0.90


def split_for_review(fields):
    """fields: list of (name, value, confidence) tuples."""
    accepted, review = [], []
    for name, value, confidence in fields:
        limit = THRESHOLDS.get(name, DEFAULT_THRESHOLD)
        if confidence is not None and confidence >= limit:
            accepted.append((name, value))
        else:
            review.append((name, value, confidence))
    return accepted, review
```

Missing confidence goes to review, not to acceptance. That one rule saves a lot of arguments later.

## Content Understanding cost lands on two bills

Document Intelligence bills per page against the model you call. Content Understanding's [pricing model](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer) has more moving parts, and it's worth understanding before you compare:

- **Content extraction** per 1,000 pages, on a minimal, basic or standard meter depending on the work actually performed. Digital files such as DOCX and HTML always bill at the minimal rate, even through a layout analyser.
- **Contextualization** (the meter name) whenever you use generative features. At the standard rate that works out to $1 per 1,000 pages; some prebuilts bill at the advanced rate, which is $3 per 1,000 pages. On the `2026-06-01-preview` API, custom analysers trained with labelled data and agentic-mode analysers also bill at the advanced rate; analysers created on `2025-11-01` stay on standard. Adding labels to lift accuracy therefore roughly triples the contextualisation charge.
- **Model tokens** on the Foundry model deployment you connect, plus embedding tokens if you train with labelled examples (about 1,500 tokens per page as a first estimate). This charge doesn't appear on the Content Understanding meter at all. It lands on your deployment, which makes it easy to miss in a cost review.

For OCR and layout alone, Microsoft's guide says Content Understanding's `prebuilt-read` and `prebuilt-layout` are the lower-cost option with richer output, and since December 2025 they don't need a model deployment. For field extraction, the generative path costs whatever your schema and pages consume in tokens. Don't estimate it from a pricing page. Run a representative sample, read the `usage` object in the response, and multiply by your volume. Rates vary by region, deployment type and model, so only your own number belongs in a business case.

## Determinism is a design property, not a slogan

Microsoft describes Document Intelligence as providing "deterministic extraction from structured documents". For a fixed-layout form, the same input gives the same output, and a version-pinned model doesn't drift. That matters for audit trails, regression tests and anyone who has to explain why a field changed between two runs.

Content Understanding results depend on the completion model behind the analyser. Change the deployment, or let a model version roll forward, and outputs can shift. The [prebuilt analysers page](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/prebuilt-analyzers) also warns that prebuilt definitions can change across API versions and recommends copying a prebuilt into your own analyser for consistent production behaviour. Treat that as mandatory. Pin the model version on your deployment, copy prebuilts, and keep a labelled regression set that runs before any model or API change. I covered [model upgrade discipline in Foundry](/blog/2026-09-23-gpt-6-in-foundry-upgrade-discipline/) separately; it applies to the model behind your analysers too.

## Confidence scores need calibration on both sides

Both services return confidence between 0 and 1. In Content Understanding, since the GA release, confidence and grounding are available for `extract`, `classify` and `generate` fields on documents, and you can enable them per field to save cost and latency. Document Intelligence returns word, field and, for custom models on `2024-11-30`, table cell confidence; its [accuracy and confidence guidance](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept/accuracy-confidence) suggests combining OCR word confidence with field confidence for a composite score.

Don't assume a 0.9 means the same thing from both engines. Set thresholds per field, per path, from your own labelled data: plot the error rate against confidence and choose the cut-off that meets the business tolerance for each field. A wrong patient name and a slightly imperfect summary don't deserve the same threshold. The same idea runs through [reliable data extraction with LLMs](/blog/2024-09-17-reliable-data-extraction/): treat uncertainty as a first-class output, not an afterthought.

## When not to migrate

Leave a Document Intelligence extractor where it is when:

- the layout is fixed or nearly so, and accuracy already meets the business threshold;
- latency matters to an end user waiting on the result;
- you need on-premises or air-gapped processing, where Document Intelligence containers are the only option today, and check the container image list, because not every model or API version ships as a container;
- your audit or regression story depends on deterministic output.

Move or add Content Understanding when the layouts keep multiplying faster than you can label them, when the fields are inferred rather than printed, when the input includes images, audio or video, or when you want RAG-ready Markdown from a single analyser. If you're starting fresh on a document type, Microsoft's guide says to begin with a prebuilt in either service before building custom, and that holds.

## The decision in one line

Route by document shape: fixed layouts to Document Intelligence, variable and multimodal content to Content Understanding, one confidence-driven review queue across both. The best migration for a stable extractor is often none at all. Spend the effort on the documents your current pipeline handles badly, and see [Azure Document Intelligence: Extracting Structured Data from Documents](/blog/2025-04-19-document-intelligence/) if you need a refresher on the deterministic side.
