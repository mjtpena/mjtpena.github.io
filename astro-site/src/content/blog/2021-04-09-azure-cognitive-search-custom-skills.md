---
title: Azure Cognitive Search Custom Skills - Building Intelligent Search Pipelines
author: Michael John Peña
draft: false
date: 2021-04-09
url: /blog/azure-cognitive-search-custom-skills/
tags:
  - Azure
  - Cognitive Search
  - AI
  - Knowledge Mining
  - Search

---

I wrote "2021-04-09-azure-cognitive-search-custom-skills" to share practical, production-minded guidance on this topic.

## Understanding the Skillset Architecture

A skillset is a collection of skills that process documents during indexing:

```
Document → Cracking → Built-in Skills → Custom Skills → Index
              ↓              ↓                ↓
         Extract text   OCR, Entity      Your logic
         + metadata    Recognition
```

## Built-in Skills Overview

Before building custom skills, understand what's available:

```yaml
Cognitive Skills:
  Vision:
    - OCR (Extract text from images)
    - Image Analysis (Tags, descriptions)
    - Custom Vision (Your trained models)

  Language:
    - Entity Recognition (People, places, orgs)
    - Key Phrase Extraction
    - Language Detection
    - Sentiment Analysis
    - PII Detection

  Text Processing:
    - Text Split (Chunking)
    - Text Merge (Combine fields)
    - Shaper (Restructure data)
```

## Building a Custom Skill

Custom skills are Azure Functions that implement a specific contract.

### Skill Interface Contract

```json
// Input
{
  "values": [
    {
      "recordId": "1",
      "data": {
        "text": "Document content here...",
        "language": "en"
      }
    }
  ]
}

// Output
{
  "values": [
    {
      "recordId": "1",
      "data": {
        "customField": "processed value"
      },
      "errors": [],
      "warnings": []
    }
  ]
}
```

### Custom Skill: Industry Classification

```csharp
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

public static class IndustryClassificationSkill
{
    private static readonly Dictionary<string, string[]> IndustryKeywords = new()
    {
        ["Healthcare"] = new[] { "patient", "medical", "hospital", "diagnosis", "treatment", "physician" },
        ["Finance"] = new[] { "investment", "portfolio", "trading", "securities", "banking", "loan" },
        ["Technology"] = new[] { "software", "cloud", "api", "database", "programming", "algorithm" },
        ["Manufacturing"] = new[] { "production", "assembly", "inventory", "quality", "supply chain" },
        ["Retail"] = new[] { "customer", "sales", "store", "merchandise", "shopping", "purchase" }
    };

    [FunctionName("IndustryClassification")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Industry Classification skill processing request.");

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        var request = JsonConvert.DeserializeObject<SkillRequest>(requestBody);

        var response = new SkillResponse
        {
            Values = new List<SkillResponseRecord>()
        };

        foreach (var record in request.Values)
        {
            var responseRecord = new SkillResponseRecord
            {
                RecordId = record.RecordId,
                Data = new Dictionary<string, object>(),
                Errors = new List<string>(),
                Warnings = new List<string>()
            };

            try
            {
                string text = record.Data["text"]?.ToString()?.ToLower() ?? "";

                var classifications = ClassifyIndustry(text);

                responseRecord.Data["industries"] = classifications.Select(c => c.Industry).ToArray();
                responseRecord.Data["primaryIndustry"] = classifications.FirstOrDefault()?.Industry ?? "Unknown";
                responseRecord.Data["industryScores"] = classifications;
            }
            catch (Exception ex)
            {
                responseRecord.Errors.Add($"Error processing record: {ex.Message}");
            }

            response.Values.Add(responseRecord);
        }

        return new OkObjectResult(response);
    }

    private static List<IndustryScore> ClassifyIndustry(string text)
    {
        var scores = new List<IndustryScore>();

        foreach (var industry in IndustryKeywords)
        {
            int matchCount = industry.Value.Count(keyword => text.Contains(keyword));
            if (matchCount > 0)
            {
                scores.Add(new IndustryScore
                {
                    Industry = industry.Key,
                    Score = (double)matchCount / industry.Value.Length,
                    MatchedKeywords = industry.Value.Where(k => text.Contains(k)).ToArray()
                });
            }
        }

        return scores.OrderByDescending(s => s.Score).ToList();
    }
}

public class SkillRequest
{
    public List<SkillRequestRecord> Values { get; set; }
}

public class SkillRequestRecord
{
    public string RecordId { get; set; }
    public Dictionary<string, object> Data { get; set; }
}

public class SkillResponse
{
    public List<SkillResponseRecord> Values { get; set; }
}

public class SkillResponseRecord
{
    public string RecordId { get; set; }
    public Dictionary<string, object> Data { get; set; }
    public List<string> Errors { get; set; }
    public List<string> Warnings { get; set; }
}

public class IndustryScore
{
    public string Industry { get; set; }
    public double Score { get; set; }
    public string[] MatchedKeywords { get; set; }
}
```

### Custom Skill: Document Summarization

```csharp
using Azure;
using Azure.AI.TextAnalytics;

public static class SummarizationSkill
{
    private static readonly TextAnalyticsClient _client;

    static SummarizationSkill()
    {
        var endpoint = new Uri(Environment.GetEnvironmentVariable("TEXT_ANALYTICS_ENDPOINT"));
        var credential = new AzureKeyCredential(Environment.GetEnvironmentVariable("TEXT_ANALYTICS_KEY"));
        _client = new TextAnalyticsClient(endpoint, credential);
    }

    [FunctionName("Summarize")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
        ILogger log)
    {
        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        var request = JsonConvert.DeserializeObject<SkillRequest>(requestBody);

        var response = new SkillResponse { Values = new List<SkillResponseRecord>() };

        foreach (var record in request.Values)
        {
            var responseRecord = new SkillResponseRecord
            {
                RecordId = record.RecordId,
                Data = new Dictionary<string, object>(),
                Errors = new List<string>(),
                Warnings = new List<string>()
            };

            try
            {
                string text = record.Data["text"]?.ToString() ?? "";

                if (text.Length < 100)
                {
                    responseRecord.Data["summary"] = text;
                    responseRecord.Warnings.Add("Text too short for summarization");
                }
                else
                {
                    var documents = new List<string> { text };

                    var actions = new TextAnalyticsActions
                    {
                        ExtractSummaryActions = new List<ExtractSummaryAction>
                        {
                            new ExtractSummaryAction
                            {
                                MaxSentenceCount = 3,
                                OrderBy = SummarySentencesOrderBy.Rank
                            }
                        }
                    };

                    var operation = await _client.StartAnalyzeActionsAsync(documents, actions);
                    await operation.WaitForCompletionAsync();

                    var summaries = new List<string>();
                    await foreach (var result in operation.Value)
                    {
                        foreach (var summaryResult in result.ExtractSummaryResults)
                        {
                            foreach (var doc in summaryResult.DocumentsResults)
                            {
                                summaries.AddRange(doc.Sentences.Select(s => s.Text));
                            }
                        }
                    }

                    responseRecord.Data["summary"] = string.Join(" ", summaries);
                    responseRecord.Data["summaryLength"] = summaries.Count;
                }
            }
            catch (Exception ex)
            {
                responseRecord.Errors.Add($"Summarization failed: {ex.Message}");
                responseRecord.Data["summary"] = "";
            }

            response.Values.Add(responseRecord);
        }

        return new OkObjectResult(response);
    }
}
```

## Integrating Custom Skills into Skillset

### Define the Skillset

```json
{
  "name": "document-enrichment-skillset",
  "description": "Skillset with custom skills",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Text.EntityRecognitionSkill",
      "name": "entity-recognition",
      "categories": ["Organization", "Person", "Location"],
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "organizations",
          "targetName": "organizations"
        },
        {
          "name": "persons",
          "targetName": "people"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.KeyPhraseExtractionSkill",
      "name": "key-phrases",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "keyPhrases",
          "targetName": "keyPhrases"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Custom.WebApiSkill",
      "name": "industry-classification",
      "uri": "https://your-function.azurewebsites.net/api/IndustryClassification?code=xxx",
      "httpMethod": "POST",
      "timeout": "PT30S",
      "batchSize": 10,
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "primaryIndustry",
          "targetName": "industry"
        },
        {
          "name": "industryScores",
          "targetName": "industryScores"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Custom.WebApiSkill",
      "name": "summarization",
      "uri": "https://your-function.azurewebsites.net/api/Summarize?code=xxx",
      "httpMethod": "POST",
      "timeout": "PT60S",
      "batchSize": 5,
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "summary",
          "targetName": "summary"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Util.ShaperSkill",
      "name": "document-shaper",
      "inputs": [
        {
          "name": "title",
          "source": "/document/metadata_title"
        },
        {
          "name": "content",
          "source": "/document/content"
        },
        {
          "name": "summary",
          "source": "/document/summary"
        },
        {
          "name": "industry",
          "source": "/document/industry"
        },
        {
          "name": "organizations",
          "source": "/document/organizations"
        },
        {
          "name": "keyPhrases",
          "source": "/document/keyPhrases"
        }
      ],
      "outputs": [
        {
          "name": "output",
          "targetName": "enrichedDocument"
        }
      ]
    }
  ],
  "cognitiveServices": {
    "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
    "key": "your-cognitive-services-key"
  }
}
```

### Create Index with Enriched Fields

```json
{
  "name": "enriched-documents-index",
  "fields": [
    {
      "name": "id",
      "type": "Edm.String",
      "key": true,
      "searchable": false
    },
    {
      "name": "title",
      "type": "Edm.String",
      "searchable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "content",
      "type": "Edm.String",
      "searchable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "summary",
      "type": "Edm.String",
      "searchable": true,
      "filterable": false
    },
    {
      "name": "industry",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "facetable": true
    },
    {
      "name": "organizations",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true,
      "facetable": true
    },
    {
      "name": "people",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true
    },
    {
      "name": "keyPhrases",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": false
    }
  ],
  "suggesters": [
    {
      "name": "suggestions",
      "searchMode": "analyzingInfixMatching",
      "sourceFields": ["title", "organizations", "keyPhrases"]
    }
  ]
}
```

### Configure Indexer

```json
{
  "name": "document-indexer",
  "dataSourceName": "blob-datasource",
  "targetIndexName": "enriched-documents-index",
  "skillsetName": "document-enrichment-skillset",
  "parameters": {
    "batchSize": 10,
    "maxFailedItems": -1,
    "maxFailedItemsPerBatch": -1,
    "configuration": {
      "dataToExtract": "contentAndMetadata",
      "imageAction": "generateNormalizedImages"
    }
  },
  "fieldMappings": [
    {
      "sourceFieldName": "metadata_storage_path",
      "targetFieldName": "id",
      "mappingFunction": {
        "name": "base64Encode"
      }
    },
    {
      "sourceFieldName": "metadata_storage_name",
      "targetFieldName": "title"
    }
  ],
  "outputFieldMappings": [
    {
      "sourceFieldName": "/document/summary",
      "targetFieldName": "summary"
    },
    {
      "sourceFieldName": "/document/industry",
      "targetFieldName": "industry"
    },
    {
      "sourceFieldName": "/document/organizations",
      "targetFieldName": "organizations"
    },
    {
      "sourceFieldName": "/document/people",
      "targetFieldName": "people"
    },
    {
      "sourceFieldName": "/document/keyPhrases",
      "targetFieldName": "keyPhrases"
    }
  ]
}
```

## Testing Your Skills

### Test Script

```python
import requests
import json

# Test custom skill directly
skill_url = "https://your-function.azurewebsites.net/api/IndustryClassification"
skill_key = "your-function-key"

test_request = {
    "values": [
        {
            "recordId": "test1",
            "data": {
                "text": "The hospital implemented a new patient management system to improve diagnosis workflows and treatment protocols."
            }
        }
    ]
}

headers = {
    "Content-Type": "application/json",
    "x-functions-key": skill_key
}

response = requests.post(skill_url, json=test_request, headers=headers)
print(json.dumps(response.json(), indent=2))
```

## Best Practices

1. **Handle errors gracefully** - Return partial results when possible
2. **Implement timeouts** - Skills have time limits
3. **Batch efficiently** - Process multiple records per call
4. **Log extensively** - Debug issues in production
5. **Version your skills** - Use deployment slots for updates
6. **Cache results** - For expensive operations
7. **Monitor performance** - Track latency and errors

## Conclusion

Custom skills unlock unlimited possibilities in Azure Cognitive Search. Whether you need specialized entity extraction, industry-specific classification, or integration with external services, custom skills let you build exactly what your search solution needs. The combination of built-in cognitive skills with custom logic creates powerful knowledge mining pipelines.

