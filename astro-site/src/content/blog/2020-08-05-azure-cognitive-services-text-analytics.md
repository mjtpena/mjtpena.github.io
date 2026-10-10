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

| Capability | Status (Aug 2020) | What you get back |
|---|---|---|
| Sentiment analysis | GA (v3.0) | Document label (positive, neutral, negative, mixed), per-sentence labels, three confidence scores |
| Key phrase extraction | GA (v3.0) | A list of noun-phrase style talking points |
| Named entity recognition | GA (v3.0) | Entities with category, subcategory and confidence (Person, Location, Organization, Product, Event and more) |
| Entity linking | GA (v3.0) | Entities resolved to Wikipedia entries |
| Language detection | GA (v3.0) | Language name, ISO 639-1 code, confidence |
| Opinion mining, PII detection | Preview (v3.1-preview.1) | Aspect-level sentiment; personal data entities |
| Text Analytics for health | Gated preview, containers only | Clinical entities and relations |

Two things in that table deserve a comment. First, v3 sentiment is a real step up from v2, which gave one 0–1 score per document and left the thresholds to you. v3 gives a label, a "mixed" class, and sentence-level results. For feedback that last part matters, because one review usually covers several topics.

Second, the preview features are tempting but not in the GA SDK. Opinion mining (aspect-based sentiment, so "the staff were great but checkout was slow" comes back as two opinions) arrived with the v3.1-preview.1 API ([v3.1-preview.1, May 2020](https://learn.microsoft.com/azure/ai-services/language-service/sentiment-opinion-mining/overview)), but 5.0.0 targets v3.0 and has no method for it. You can call the preview REST endpoint directly if you need it now. I wouldn't build a deliverable on a preview API, so this post sticks to v3.0.

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

The tempting pattern is `AnalyzeSentimentAsync(text)` inside a `foreach`. It works, and it's the slowest way to process a file. The batch methods send many documents per request, and the SDK README recommends them for production. The service caps each document's length (5,120 characters), the total request size (1 MB) and the number of documents per request, which differs by operation in v3.0:

- Sentiment analysis and key phrase extraction: 10 documents
- Named entity recognition and entity linking: 5 documents
- Language detection: 1,000 documents

The [current data limits page](https://learn.microsoft.com/azure/ai-services/language-service/concepts/data-limits) documents these (the synchronous v3 limits above are the ones that apply). Since 15 July 2020, exceeding the document count fails the whole request with an HTTP 400 (it used to return a warning), unlike oversized documents, which come back as per-document errors inside a successful response. So size your batches per operation, and check every result.

Give each document your own ID. Results come back in input order, but carrying the source row ID makes joining back to the CSV trivial.

The sample expects a plain text file: export the CSV's comment column first, one comment per line with the header kept, so the code doesn't need a CSV parser for quoted commas. Row IDs start at 1 for the first comment under the header.

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
    const string SentimentFile = "sentiment.csv";
    const string PhrasesFile = "keyphrases.csv";
    const string ErrorsFile = "errors.csv";

    static async Task<int> Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("Usage: dotnet run -- <comments.txt>");
            return 1;
        }

        var client = new TextAnalyticsClient(
            new Uri(Environment.GetEnvironmentVariable("TEXT_ANALYTICS_ENDPOINT")),
            new AzureKeyCredential(Environment.GetEnvironmentVariable("TEXT_ANALYTICS_KEY")));

        // Rows in sentiment.csv were analysed (and paid for) on an earlier run; rows in
        // errors.csv failed permanently (too long, invalid text) and would fail again.
        var done = new HashSet<string>();
        foreach (var file in new[] { SentimentFile, ErrorsFile }.Where(File.Exists))
        {
            done.UnionWith(File.ReadLines(file).Skip(1).Select(l => l.Split(',')[0]));
        }

        // Input: the comment column exported to a text file, one comment per line, header kept.
        var documents = File.ReadAllLines(args[0])
            .Skip(1) // drop the header row so it isn't analysed and billed as a comment
            .Select((text, row) => new TextDocumentInput((row + 1).ToString(), text) { Language = "en" })
            .Where(d => !string.IsNullOrWhiteSpace(d.Text) && !done.Contains(d.Id))
            .ToList();

        var newSentiment = !File.Exists(SentimentFile);
        var newPhrases = !File.Exists(PhrasesFile);
        var newErrors = !File.Exists(ErrorsFile);
        using (var sentimentOut = new StreamWriter(SentimentFile, append: true))
        using (var phrasesOut = new StreamWriter(PhrasesFile, append: true))
        using (var errorsOut = new StreamWriter(ErrorsFile, append: true))
        {
            if (newSentiment) await sentimentOut.WriteLineAsync("row,sentiment,positive,neutral,negative");
            if (newPhrases) await phrasesOut.WriteLineAsync("row,phrase");
            if (newErrors) await errorsOut.WriteLineAsync("row,code");

            for (var i = 0; i < documents.Count; i += BatchSize)
            {
                var batch = documents.Skip(i).Take(BatchSize).ToList();
                var sentimentLines = new List<string>();
                var phraseLines = new List<string>();
                var errorLines = new List<string>();

                try
                {
                    AnalyzeSentimentResultCollection sentiment =
                        await client.AnalyzeSentimentBatchAsync(batch);

                    var negativeIds = new HashSet<string>();
                    foreach (var result in sentiment)
                    {
                        if (result.HasError)
                        {
                            Console.WriteLine($"Row {result.Id}: {result.Error.ErrorCode} {result.Error.Message}");
                            errorLines.Add(result.Id + "," + result.Error.ErrorCode);
                            continue;
                        }

                        var doc = result.DocumentSentiment;
                        var scores = doc.ConfidenceScores;
                        // Invariant culture keeps "0.45" from becoming "0,45" and breaking the CSV.
                        sentimentLines.Add(string.Join(",",
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
                    if (toExplain.Count > 0)
                    {
                        ExtractKeyPhrasesResultCollection phrases =
                            await client.ExtractKeyPhrasesBatchAsync(toExplain);

                        foreach (var result in phrases)
                        {
                            if (result.HasError)
                            {
                                Console.WriteLine($"Row {result.Id}: {result.Error.ErrorCode} {result.Error.Message}");
                                errorLines.Add(result.Id + "," + result.Error.ErrorCode);
                                continue;
                            }

                            foreach (var phrase in result.KeyPhrases)
                            {
                                // Quote the phrase and strip any quotes inside it to keep the CSV valid.
                                var clean = phrase.Replace("\"", "");
                                phraseLines.Add(result.Id + ",\"" + clean + "\"");
                            }
                        }
                    }
                }
                catch (RequestFailedException ex)
                {
                    // Retries are exhausted. Everything written so far is kept; rerun to resume.
                    Console.Error.WriteLine($"Stopped at batch starting row {batch[0].Id}: {ex.Status} {ex.Message}");
                    return 2;
                }

                // Write a batch only once both calls succeeded, so a resumed run never skips half a batch.
                foreach (var line in sentimentLines) await sentimentOut.WriteLineAsync(line);
                foreach (var line in phraseLines) await phrasesOut.WriteLineAsync(line);
                foreach (var line in errorLines) await errorsOut.WriteLineAsync(line);
                await sentimentOut.FlushAsync();
                await phrasesOut.FlushAsync();
                await errorsOut.FlushAsync();
            }
        }

        // Rank phrases across every run, not just this one.
        var top = File.ReadLines(PhrasesFile).Skip(1)
            .Select(l => l.Substring(l.IndexOf(',') + 1).Trim('"'))
            .GroupBy(p => p, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(g => g.Count())
            .Take(25);

        foreach (var group in top)
        {
            Console.WriteLine($"{group.Count(),5}  {group.Key}");
        }

        return 0;
    }
}
```

A few deliberate choices in there:

- **`Language = "en"` is set explicitly.** The client defaults to English anyway, but being explicit makes the assumption visible. If your feedback is multilingual, run `DetectLanguageBatchAsync` first and set each document's language from the result. Sentiment and key phrases on the wrong language produce confident-looking nonsense rather than errors.
- **Mixed counts as a complaint.** "Love the range, the delivery was a disaster" is exactly the kind of comment a retailer needs to read. Filtering only on `Negative` throws those away.
- **Key phrases only run on negative and mixed comments.** That saves cost and produces a sharper list. The top 25 phrases from unhappy customers is a far better conversation starter than the top 25 phrases overall, which tend to be the product categories.
- **Failures are recorded, and the job resumes.** Both loops check `HasError` first, because reading `DocumentSentiment` or `KeyPhrases` on a failed result throws. Failed rows go to `errors.csv` with their error code and are skipped on later runs, so a comment over 5,120 characters isn't resent every time; review that file and split those comments by hand. Azure.Core's default retry policy handles throttling (HTTP 429) and transient 5xx responses; when its three retries run out, the sample stops, keeps every completed batch, and the next run skips rows already written.

## Store the scores, not just the label

Write all three confidence scores to your output, every time. A "neutral" document scored 0.45 positive, 0.45 neutral and 0.10 negative tells a different story from one scored 0.02, 0.96 and 0.02, and the label alone hides that. With scores stored, you can sort by negative confidence to find the angriest comments and change thresholds later without paying to re-run anything.

Sentence-level results (`doc.Sentences`, each with its own `Text`, `Sentiment` and `ConfidenceScores`) are worth persisting if people will drill into individual comments; that's where mixed reviews make sense.

## What it costs

Billing is per **text record**, not per request and not per character. A text record is up to 1,000 characters, so a 2,500-character complaint counts as three records. Each operation is billed separately: running sentiment, key phrases and entity recognition over the same document is three charges. The free tier covers 5,000 text records a month, and the Standard tier is pay-as-you-go with lower per-1,000 rates at higher volumes. Check the [Text Analytics pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/text-analytics/) for your region before you quote a number to anyone.

Do the arithmetic first. 8,000 short comments through sentiment, key phrases and NER is at least 24,000 records, nearly five times the free tier, before counting long comments or re-runs. The sample above is leaner: 8,000 sentiment records plus key phrases on the negative and mixed subset only. If, say, a third of the comments come back negative or mixed, that adds about 2,700 records, so roughly 10,700 in total. Either way, that's still cheap at Standard rates for a one-off. It stops being cheap when someone schedules the same pipeline nightly over a year of long support tickets. Storing results so you never re-analyse the same text is the biggest cost control you have.

## Where it falls short

- **Entities are generic.** NER recognises people, places, organisations, products and dates as the world at large knows them. It will miss internal product names and store codes, and occasionally miscategorise a brand. Treat it as a starting point for tagging, not a source of truth. If you need domain-specific entities, a custom model is the next step.
- **Sentiment isn't intent.** "Do you ship to New Zealand?" is neutral and still a lost sale. If the business question is "what do customers want?" rather than "how do they feel?", you need classification, not sentiment. LUIS only suits short, single-intent text such as chat messages or survey one-liners; it caps utterances at 500 characters. For multi-sentence reviews, train a custom text classifier in Azure Machine Learning or ML.NET on a few hundred labelled comments. The trade-off is labelling effort up front in exchange for categories that match the business question.
- **Short text is noisy.** One- and two-word responses ("ok", "fine thanks") produce low-information results. Filter them out or report them separately.
- **Data residency is your call.** The text leaves your network for the Azure region you chose. If feedback may contain names, emails or card fragments, agree with the client that this is acceptable before you send anything. If the text can't leave the network, sentiment analysis is available as a GA container, and key phrase extraction and language detection as preview containers (see the [Cognitive Services containers](https://learn.microsoft.com/azure/ai-services/cognitive-services-container-support) page). They run on your own infrastructure and send only billing metering to Azure.

## When to use something else

The code above is for a repeatable job that a developer owns. Two lower-code options cover a lot of business analyst questions better:

- **Power BI AI Insights.** If the feedback is already headed for a Power BI report and the organisation has Premium capacity, Power Query's AI Insights adds sentiment scores and key phrases as columns with no code and no separate Azure resource. For a one-off report question, that's the shortest path.
- **AI Builder in Power Automate.** If comments arrive one at a time (a form submission, an email, a Dataverse record) and the goal is to route the negative ones to a person, AI Builder's prebuilt sentiment, key phrase and language detection models do it inside a flow, paid for with AI Builder capacity rather than an Azure subscription.

And if you already have a pipeline on the **v2.1** API, which is still available, don't move it to v3.0 just because it's newer. Thresholds, alerts and historical charts built on the v2.1 score won't carry over to v3.0's labels. Move when you can re-baseline those numbers. For new work, start on v3.0.

## My take

For "what are customers saying about us", Text Analytics v3 covers most of the job out of the box: sentiment with sentence-level detail, key phrases to explain the negatives, and entities to slice by product or location. Batch your calls, carry your own document IDs, persist all three confidence scores, and budget per text record per operation. Reach for custom models only when the generic entities and the sentiment-versus-intent gap actually block the business question. Most feedback projects never get that far, and the ones that do are easier to scope with this baseline running.
