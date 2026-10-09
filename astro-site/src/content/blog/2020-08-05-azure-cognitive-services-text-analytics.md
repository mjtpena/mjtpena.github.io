---
title: "Analyzing Text with Azure Cognitive Services Text Analytics"
description: "A retail client this week handed me six months of customer feedback in a CSV and asked the question I get every couple of months: \"what are people actually…"
author: Michael John Peña
draft: false
date: 2020-08-05
tags:
  - Azure
  - AI
  - Cognitive Services
  - NLP
---

A retail client this week handed me six months of customer feedback in a CSV and asked the question I get every couple of months: "what are people actually saying?" Reading 8,000 free-text responses by hand is not happening. Text Analytics is the boring-but-effective answer for this kind of work — sentiment, key phrases, entities, with no model to train and no GPU to babysit. A walkthrough of the bits I actually use.

## Features Available

Text Analytics currently offers:
- **Sentiment Analysis** - Detect positive, negative, or neutral sentiment
- **Key Phrase Extraction** - Identify main talking points
- **Language Detection** - Identify the language of input text
- **Named Entity Recognition** - Extract entities like people, places, organizations

## Setting Up the Service

```bash
# Create a Cognitive Services resource
az cognitiveservices account create \
    --name text-analytics-demo \
    --resource-group rg-cognitive \
    --kind TextAnalytics \
    --sku S \
    --location australiaeast \
    --yes

# Get the key
az cognitiveservices account keys list \
    --name text-analytics-demo \
    --resource-group rg-cognitive
```

## Using the .NET SDK

```bash
dotnet add package Azure.AI.TextAnalytics
```

## Sentiment Analysis

```csharp
using Azure;
using Azure.AI.TextAnalytics;

public class TextAnalyticsService
{
    private readonly TextAnalyticsClient _client;

    public TextAnalyticsService(string endpoint, string key)
    {
        var credentials = new AzureKeyCredential(key);
        _client = new TextAnalyticsClient(new Uri(endpoint), credentials);
    }

    public async Task<SentimentResult> AnalyzeSentimentAsync(string text)
    {
        var response = await _client.AnalyzeSentimentAsync(text);
        var sentiment = response.Value;

        return new SentimentResult
        {
            Sentiment = sentiment.Sentiment.ToString(),
            PositiveScore = sentiment.ConfidenceScores.Positive,
            NeutralScore = sentiment.ConfidenceScores.Neutral,
            NegativeScore = sentiment.ConfidenceScores.Negative,
            Sentences = sentiment.Sentences.Select(s => new SentenceSentiment
            {
                Text = s.Text,
                Sentiment = s.Sentiment.ToString()
            }).ToList()
        };
    }
}

public class SentimentResult
{
    public string Sentiment { get; set; }
    public double PositiveScore { get; set; }
    public double NeutralScore { get; set; }
    public double NegativeScore { get; set; }
    public List<SentenceSentiment> Sentences { get; set; }
}

public class SentenceSentiment
{
    public string Text { get; set; }
    public string Sentiment { get; set; }
}
```

## Batch Processing

For efficiency, process multiple documents in batches:

```csharp
public async Task<List<SentimentResult>> AnalyzeBatchAsync(List<string> documents)
{
    var response = await _client.AnalyzeSentimentBatchAsync(documents);

    return response.Value
        .Where(r => !r.HasError)
        .Select(r => new SentimentResult
        {
            Sentiment = r.DocumentSentiment.Sentiment.ToString(),
            PositiveScore = r.DocumentSentiment.ConfidenceScores.Positive,
            NeutralScore = r.DocumentSentiment.ConfidenceScores.Neutral,
            NegativeScore = r.DocumentSentiment.ConfidenceScores.Negative
        })
        .ToList();
}
```

## Key Phrase Extraction

```csharp
public async Task<List<string>> ExtractKeyPhrasesAsync(string text)
{
    var response = await _client.ExtractKeyPhrasesAsync(text);
    return response.Value.ToList();
}

// Example usage
var text = "Azure Cognitive Services provides AI capabilities for developers. " +
           "The Text Analytics API offers sentiment analysis and key phrase extraction.";

var keyPhrases = await service.ExtractKeyPhrasesAsync(text);
// Returns: ["Azure Cognitive Services", "AI capabilities", "developers",
//           "Text Analytics API", "sentiment analysis", "key phrase extraction"]
```

## Named Entity Recognition

```csharp
public async Task<List<EntityResult>> RecognizeEntitiesAsync(string text)
{
    var response = await _client.RecognizeEntitiesAsync(text);

    return response.Value.Select(e => new EntityResult
    {
        Text = e.Text,
        Category = e.Category.ToString(),
        SubCategory = e.SubCategory,
        ConfidenceScore = e.ConfidenceScore
    }).ToList();
}

public class EntityResult
{
    public string Text { get; set; }
    public string Category { get; set; }
    public string SubCategory { get; set; }
    public double ConfidenceScore { get; set; }
}
```

## Language Detection

```csharp
public async Task<DetectedLanguage> DetectLanguageAsync(string text)
{
    var response = await _client.DetectLanguageAsync(text);
    var language = response.Value;

    return new DetectedLanguage
    {
        Name = language.Name,
        IsoCode = language.Iso6391Name,
        ConfidenceScore = language.ConfidenceScore
    };
}
```

## Practical Application: Customer Feedback Analysis

```csharp
public class FeedbackAnalyzer
{
    private readonly TextAnalyticsService _textAnalytics;

    public async Task<FeedbackAnalysis> AnalyzeFeedbackAsync(string feedback)
    {
        var sentimentTask = _textAnalytics.AnalyzeSentimentAsync(feedback);
        var keyPhrasesTask = _textAnalytics.ExtractKeyPhrasesAsync(feedback);
        var entitiesTask = _textAnalytics.RecognizeEntitiesAsync(feedback);

        await Task.WhenAll(sentimentTask, keyPhrasesTask, entitiesTask);

        return new FeedbackAnalysis
        {
            OriginalText = feedback,
            Sentiment = sentimentTask.Result,
            KeyPhrases = keyPhrasesTask.Result,
            Entities = entitiesTask.Result
        };
    }
}
```

## Things to know before shipping this

- **It's per-record billing, not per-character.** Long documents get split. Cheap on small samples, surprisingly not-cheap when you point it at a year of support tickets without thinking.
- **The free tier (5,000 transactions/month) is enough to demo and prototype.** Enough to convince stakeholders it's worth doing properly.
- **Sentiment confidence scores beat the label.** A "neutral" document at 0.45/0.45/0.10 is interesting in a way "neutral" alone isn't. Always log all three confidences.
- **Don't use NER as your primary entity store.** It will hallucinate "Apple" as a person sometimes, and miss internal product names entirely. It's a starting point, not a source of truth.

For "what are customers saying about us" dashboards, this is genuinely 80% of what you need. The remaining 20% — domain-specific entities, custom intents — is where you graduate to LUIS or roll your own model. But you don't start there. You start here.
