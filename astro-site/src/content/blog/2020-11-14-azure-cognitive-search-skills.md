---
title: "Azure Cognitive Search: AI-Powered Skillsets"
description: "Indexing PDFs is easy. Indexing PDFs in a way that makes them findable is a different sport. Cognitive Search skillsets are the part I usually sell to…"
author: Michael John Peña
draft: false
date: 2020-11-14
tags:
  - Azure
  - Cognitive Search
  - AI
  - Search
---

Indexing PDFs is easy. Indexing PDFs in a way that makes them *findable* is a different sport. Cognitive Search skillsets are the part I usually sell to clients before they realise they want them: OCR scanned documents, extract entities, classify, translate, and write enriched fields back into the index—all during ingest. The first time a legal team sees "search by person mentioned in the document" working out of the box, the project sells itself.

## Skillset Architecture

```
Documents → Indexer → Skillset → Enriched Index
                        │
                        ├── OCR Skill
                        ├── Entity Recognition
                        ├── Key Phrase Extraction
                        ├── Sentiment Analysis
                        └── Custom Skills (Functions)
```

## Built-in Skills

| Skill | Purpose |
|-------|---------|
| OCR | Extract text from images |
| Image Analysis | Describe images, extract tags |
| Entity Recognition | People, places, organizations |
| Key Phrase Extraction | Main topics |
| Language Detection | Identify language |
| Sentiment | Positive/negative analysis |
| Text Translation | Translate to target language |
| PII Detection | Find personal information |

## Creating a Skillset

```json
{
    "name": "document-skillset",
    "description": "Extract insights from documents",
    "skills": [
        {
            "@odata.type": "#Microsoft.Skills.Vision.OcrSkill",
            "name": "ocr",
            "context": "/document/normalized_images/*",
            "inputs": [
                { "name": "image", "source": "/document/normalized_images/*" }
            ],
            "outputs": [
                { "name": "text", "targetName": "ocrText" }
            ]
        },
        {
            "@odata.type": "#Microsoft.Skills.Text.MergeSkill",
            "name": "merge",
            "context": "/document",
            "inputs": [
                { "name": "text", "source": "/document/content" },
                { "name": "itemsToInsert", "source": "/document/normalized_images/*/ocrText" }
            ],
            "outputs": [
                { "name": "mergedText", "targetName": "mergedContent" }
            ]
        },
        {
            "@odata.type": "#Microsoft.Skills.Text.EntityRecognitionSkill",
            "name": "entities",
            "context": "/document",
            "categories": ["Person", "Organization", "Location"],
            "inputs": [
                { "name": "text", "source": "/document/mergedContent" }
            ],
            "outputs": [
                { "name": "persons", "targetName": "people" },
                { "name": "organizations", "targetName": "organizations" },
                { "name": "locations", "targetName": "locations" }
            ]
        },
        {
            "@odata.type": "#Microsoft.Skills.Text.KeyPhraseExtractionSkill",
            "name": "keyphrases",
            "context": "/document",
            "inputs": [
                { "name": "text", "source": "/document/mergedContent" }
            ],
            "outputs": [
                { "name": "keyPhrases", "targetName": "keyPhrases" }
            ]
        },
        {
            "@odata.type": "#Microsoft.Skills.Text.SentimentSkill",
            "name": "sentiment",
            "context": "/document",
            "inputs": [
                { "name": "text", "source": "/document/mergedContent" }
            ],
            "outputs": [
                { "name": "score", "targetName": "sentimentScore" }
            ]
        }
    ],
    "cognitiveServices": {
        "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
        "key": "your-cognitive-services-key"
    }
}
```

## Index Schema

```json
{
    "name": "documents-index",
    "fields": [
        { "name": "id", "type": "Edm.String", "key": true },
        { "name": "content", "type": "Edm.String", "searchable": true },
        { "name": "mergedContent", "type": "Edm.String", "searchable": true },
        { "name": "people", "type": "Collection(Edm.String)", "filterable": true, "facetable": true },
        { "name": "organizations", "type": "Collection(Edm.String)", "filterable": true, "facetable": true },
        { "name": "locations", "type": "Collection(Edm.String)", "filterable": true, "facetable": true },
        { "name": "keyPhrases", "type": "Collection(Edm.String)", "filterable": true, "facetable": true },
        { "name": "sentimentScore", "type": "Edm.Double", "filterable": true, "sortable": true }
    ]
}
```

## Custom Skills (Azure Function)

```csharp
[FunctionName("CustomEntityExtractor")]
public static async Task<IActionResult> Run(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req)
{
    var requestBody = await new StreamReader(req.Body).ReadToEndAsync();
    var input = JsonConvert.DeserializeObject<SkillInput>(requestBody);

    var results = new List<SkillOutput>();

    foreach (var record in input.Values)
    {
        var text = record.Data["text"]?.ToString();
        var customEntities = ExtractCustomEntities(text);

        results.Add(new SkillOutput
        {
            RecordId = record.RecordId,
            Data = new { customEntities = customEntities }
        });
    }

    return new OkObjectResult(new { values = results });
}
```

```json
// Custom skill definition
{
    "@odata.type": "#Microsoft.Skills.Custom.WebApiSkill",
    "name": "custom-extractor",
    "uri": "https://myfunction.azurewebsites.net/api/CustomEntityExtractor",
    "httpHeaders": {
        "x-functions-key": "function-key"
    },
    "context": "/document",
    "inputs": [
        { "name": "text", "source": "/document/content" }
    ],
    "outputs": [
        { "name": "customEntities", "targetName": "customEntities" }
    ]
}
```

Skillsets transform raw documents into searchable knowledge.
