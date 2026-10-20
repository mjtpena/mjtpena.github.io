---
title: "Mining Customer Feedback with Azure Text Analytics v3"
description: "Using Azure Cognitive Services Text Analytics v3 and the .NET SDK to triage customer feedback: sentiment, key phrases, entities, batching and cost."
author: Michael John Peña
draft: false
date: 2020-08-05
tags:
  - Azure
  - Cognitive Services
  - Text Analytics
  - NLP
  - .NET
---

A retail client this week handed me six months of customer feedback in a CSV and asked the question I get every couple of months: "what are people actually saying?" Reading 8,000 free-text responses by hand is not happening. Training a custom model for a one-off question is overkill. Azure Cognitive Services Text Analytics sits in the useful middle: pre-trained sentiment, key phrases, entities and language detection behind one REST endpoint. The API is the easy part; how you batch, store and pay for the calls decides whether the project works.

## What the service actually gives you (August 2020)

The generally available API is **v3.0**, and the GA .NET client is [`Azure.AI.TextAnalytics` 5.0.0](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/textanalytics/Azure.AI.TextAnalytics/CHANGELOG.md), released on 27 July 2020. If you installed 1.0.1 in June, 5.0.0 is a re-release of the same code under a new version number. Coming from 1.0.0, note that 1.0.1 changed `TextAnalyticsErrorCode` casing to PascalCase and corrected the document confidence scores, so check any code that compares error codes.

| Capability | Status today | What you get back |
|---|---|---|
| Sentiment analysis | GA (v3.0) | Document label (positive, neutral, negative, mixed), per-sentence labels, three confidence scores |
| Key phrase extraction | GA (v3.0) | A list of noun-phrase style talking points |
| Named entity recognition | GA (v3.0) | Entities with category, subcategory and confidence (Person, Location, Organization, Product, Event and more) |
| Entity linking | GA (v3.0) | Entities resolved to Wikipedia entries |
| Language detection | GA (v3.0) | Language name, ISO 639-1 code, confidence |
| Opinion mining, PII detection | Preview (v3.1-preview.1) | Aspect-level sentiment; personal data entities |
| Text Analytics for health | Gated preview, containers only | Clinical entities and relations |

Two things in that table deserve a comment. First, v3 sentiment is a real step up from v2. The old API gave you one score between 0 and 1 per document, and you had to invent your own thresholds. v3 gives a label, a "mixed" class for documents that are positive about one thing and negative about another, and sentence-level results. For feedback analysis that last part is the useful bit, because one review usually covers several topics.

Second, the preview features are tempting but not in the GA SDK. Opinion mining (aspect-based sentiment, so "the staff were great but checkout was slow" comes back as two opinions) arrived with the [v3.1-preview.1 API](https://azure.microsoft.com/updates/opinion-mining-is-now-available-in-text-analytics-in-public-preview/), but 5.0.0 targets v3.0 and has no method for it. You can call the preview REST endpoint directly if you need it now. I wouldn't build a deliverable on a preview API, so this post sticks to v3.0.

## Provisioning

A Text Analytics resource is a Cognitive Services account of kind `TextAnalytics`. The free `F0` tier is fine for a spike. Use `S` for anything you'll run against the full dataset.

```bash
az cognitiveservices account create \
    --name <your-resource-name> \
    --resource-group <your-resource-group> \
    --kind TextAnalytics \
    --sku S \
    --location australiaeast \
    --yes

az cognitiveservices account show \
    --name <your-resource-name> \
    --resource-group <your-resource-group> \
    --query properties.endpoint --output tsv

az cognitiveservices account keys list \
    --name <your-resource-name> \
    --resource-group <your-resource-group>
```

Put the endpoint and key in environment variables or Key Vault, not in `appsettings.json` checked into source control.

### Project setup

Create a console app and add the GA SDK, pinned to the version this post was written against:

```bash
dotnet new console -n FeedbackTriage
cd FeedbackTriage
dotnet add package Azure.AI.TextAnalytics --version 5.0.0
```

## Batch, don't loop

The tempting pattern is one call per comment: `AnalyzeSentimentAsync(text)` inside a `foreach`. It works, and it is the slowest and noisiest way to process a file. The SDK's batch methods send many documents in one request, and the SDK README explicitly recommends them for production. The service caps each document's length (5,120 characters), the total request size (1 MB) and the number of documents per request, which differs by operation in v3.0:

- Sentiment analysis and key phrase extraction: 10 documents
- Named entity recognition and entity linking: 5 documents
- Language detection: 1,000 documents

The [current data limits page](https://learn.microsoft.com/azure/ai-services/language-service/concepts/data-limits) documents these (the synchronous v3 limits above are the ones that apply). Exceeding the document count fails the whole request with an HTTP 400, unlike oversized documents, which come back as per-document errors inside a successful response. So size your batches per operation, and check every result.

Give each document your own ID. The batch result collection is returned in input order, but carrying the source row ID through makes joining results back to the original CSV trivial and survives any later reshuffling.

Replace `Program.cs` with:

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Azure;
using Azure.AI.TextAnalytics;

class Program
{
    // 10 is the per-request maximum for sentiment and key phrases (NER and entity linking allow 5).
    const int BatchSize = 10;

    static async Task Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("Usage: dotnet run -- <feedback.txt>");
            return;
        }

        var client = new TextAnalyticsClient(
            new Uri(Environment.GetEnvironmentVariable("TEXT_ANALYTICS_ENDPOINT")),
            new AzureKeyCredential(Environment.GetEnvironmentVariable("TEXT_ANALYTICS_KEY")));

        // Input: one comment per line. A real CSV with quoted commas needs a proper parser.
        var documents = File.ReadAllLines(args[0])
            .Select((text, row) => new TextDocumentInput(row.ToString(), text) { Language = "en" })
            .Where(d => !string.IsNullOrWhiteSpace(d.Text))
            .ToList();

        var negativePhrases = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        using var output = new StreamWriter("sentiment.csv");
        await output.WriteLineAsync("row,sentiment,positive,neutral,negative");

        for (var i = 0; i < documents.Count; i += BatchSize)
        {
            var batch = documents.Skip(i).Take(BatchSize).ToList();

            AnalyzeSentimentResultCollection sentiment =
                await client.AnalyzeSentimentBatchAsync(batch);

            var negativeIds = new HashSet<string>();
            foreach (var result in sentiment)
            {
                if (result.HasError)
                {
                    Console.WriteLine($"Row {result.Id}: {result.Error.ErrorCode} {result.Error.Message}");
                    continue;
                }

                var doc = result.DocumentSentiment;
                var scores = doc.ConfidenceScores;
                // Invariant culture keeps "0.45" from becoming "0,45" and breaking the CSV.
                await output.WriteLineAsync(string.Join(",",
                    result.Id,
                    doc.Sentiment,
                    scores.Positive.ToString(CultureInfo.InvariantCulture),
                    scores.Neutral.ToString(CultureInfo.InvariantCulture),
                    scores.Negative.ToString(CultureInfo.InvariantCulture)));

                if (doc.Sentiment == TextSentiment.Negative || doc.Sentiment == TextSentiment.Mixed)
                {
                    negativeIds.Add(result.Id);
                }
            }

            // Only spend key phrase calls on the comments we care about.
            var toExplain = batch.Where(d => negativeIds.Contains(d.Id)).ToList();
            if (toExplain.Count == 0) continue;

            ExtractKeyPhrasesResultCollection phrases =
                await client.ExtractKeyPhrasesBatchAsync(toExplain);

            foreach (var result in phrases)
            {
                if (result.HasError)
                {
                    Console.WriteLine($"Row {result.Id}: {result.Error.ErrorCode} {result.Error.Message}");
                    continue;
                }

                foreach (var phrase in result.KeyPhrases)
                {
                    negativePhrases[phrase] = negativePhrases.GetValueOrDefault(phrase) + 1;
                }
            }
        }

        foreach (var (phrase, count) in negativePhrases.OrderByDescending(p => p.Value).Take(25))
        {
            Console.WriteLine($"{count,5}  {phrase}");
        }
    }
}
```

A few deliberate choices in there:

- **`Language = "en"` is set explicitly.** The client defaults to English anyway, but being explicit makes the assumption visible. If your feedback is multilingual, run `DetectLanguageBatchAsync` first and set each document's language from the result. Sentiment and key phrases on the wrong language produce confident-looking nonsense rather than errors.
- **Mixed counts as a complaint.** "Love the range, the delivery was a disaster" is exactly the kind of comment a retailer needs to read. Filtering only on `Negative` throws those away.
- **Key phrases only run on negative and mixed comments.** That is a cost decision, covered below, and it also produces a sharper list. The top 25 phrases from unhappy customers is a far better conversation starter than the top 25 phrases overall, which tend to be the product categories.
- **Errors are logged per document, not thrown.** Both loops check `HasError` first, because accessing `DocumentSentiment` or `KeyPhrases` on a failed result throws. Azure.Core's default retry policy already handles throttling (HTTP 429) and transient 5xx responses with backoff, so you don't need to write your own retry loop.

## Store the scores, not just the label

Write all three confidence scores to your output, every time. A "neutral" document scored 0.45 positive, 0.45 neutral and 0.10 negative tells a different story from one scored 0.02, 0.96 and 0.02, and the label alone hides that. Once the scores are in a table, you can sort by negative confidence to find the angriest comments, chart sentiment by month or store, and change your thresholds later without paying to re-run the analysis.

Sentence-level results (`doc.Sentences`, each with its own `Text`, `Sentiment` and `ConfidenceScores`) are worth persisting too, if the dashboard will let people drill into individual comments. That's where the mixed-sentiment reviews make sense to a human reader.

## What it costs

Billing is per **text record**, not per request and not per character. A text record is up to 1,000 characters, so a 2,500-character complaint counts as three records. Each operation is billed separately: running sentiment, key phrases and entity recognition over the same document is three charges. The free tier covers 5,000 text records a month, and the Standard tier is pay-as-you-go with lower per-1,000 rates at higher volumes. Check the [pricing page](https://azure.microsoft.com/pricing/details/language/) for your region before you quote a number to anyone.

Do the arithmetic before you start. 8,000 short comments through sentiment, key phrases and NER is at least 24,000 records, nearly five times the free tier, before counting long comments or re-runs. The sample above is leaner: 8,000 sentiment records plus key phrases on the negative and mixed subset (typically 20–40% of feedback), so roughly 10,000–11,000 records. Either way, that's still cheap at Standard rates for a one-off. It stops being cheap when someone points the same pipeline at a year of support tickets that average several thousand characters each and schedules it nightly. That's why the sample above runs key phrases only where they earn their keep, and why storing results so you never re-analyse the same text is the single biggest cost control you have.

## Where it falls short

- **Entities are generic.** NER recognises people, places, organisations, products and dates as the world at large knows them. It will miss your client's internal product names, store codes and loyalty tier names, and it will occasionally put a brand in the wrong category. Treat it as a starting point for tagging, not a source of truth. If you need domain-specific entities, LUIS or a custom model in Azure Machine Learning is the next step.
- **Sentiment isn't intent.** "Do you ship to New Zealand?" is neutral and still a lost sale. If the business question is "what do customers want?" rather than "how do they feel?", you need classification (custom or LUIS), not sentiment.
- **Short text is noisy.** One- and two-word responses ("ok", "fine thanks") produce low-information results. Filter them out or report them separately.
- **Data residency is your call.** The text leaves your network for the Azure region you chose. For feedback that may contain names, emails or card fragments, decide with the client whether that's acceptable before you send anything, rather than after. If the text can't leave the network, sentiment analysis is available as a GA container, and key phrase extraction and language detection as preview containers (see the [Cognitive Services containers](https://learn.microsoft.com/azure/ai-services/cognitive-services-container-support) page). They run on your own infrastructure and send only billing metering to Azure.

## My take

For "what are customers saying about us", Text Analytics v3 covers most of the job out of the box: sentiment with sentence-level detail, key phrases to explain the negatives, and entities to slice by product or location. Batch your calls, carry your own document IDs, persist all three confidence scores, and budget per text record per operation. Reach for custom models only when the generic entities and the sentiment-versus-intent gap actually block the business question. Most feedback projects never get that far, and the ones that do are much easier to scope once you have this baseline running.
