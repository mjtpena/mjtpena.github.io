---
title: Advanced Azure Cognitive Search Techniques
author: Michael John Pena
draft: false
date: 2021-01-27
url: /blog/azure-cognitive-search-advanced/
tags:
  - Azure
  - Cognitive Search
  - Search
  - AI
  - Full-Text Search
---

Default Cognitive Search will get you to "decent enough." Excellent search is a tuning exercise, and the levers that matter are mostly hidden. Custom analyzers when stemming and tokenisation rules need adjusting for your domain. Scoring profiles when "newer" or "more popular" should outweigh raw relevance. Skillsets for AI enrichment that turns unstructured PDFs into structured fields. Today's post is the advanced techniques I reach for once "default index" stops cutting it.

## Index Design Fundamentals

A well-designed index is crucial for search performance:

```json
{
  "name": "products-index",
  "fields": [
    {
      "name": "id",
      "type": "Edm.String",
      "key": true,
      "searchable": false
    },
    {
      "name": "name",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "sortable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "description",
      "type": "Edm.String",
      "searchable": true,
      "analyzer": "custom_text_analyzer"
    },
    {
      "name": "category",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "facetable": true
    },
    {
      "name": "tags",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true,
      "facetable": true
    },
    {
      "name": "price",
      "type": "Edm.Double",
      "filterable": true,
      "sortable": true,
      "facetable": true
    },
    {
      "name": "rating",
      "type": "Edm.Double",
      "filterable": true,
      "sortable": true
    },
    {
      "name": "reviewCount",
      "type": "Edm.Int32",
      "filterable": true,
      "sortable": true
    },
    {
      "name": "location",
      "type": "Edm.GeographyPoint",
      "filterable": true,
      "sortable": true
    },
    {
      "name": "createdAt",
      "type": "Edm.DateTimeOffset",
      "filterable": true,
      "sortable": true
    },
    {
      "name": "descriptionVector",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "dimensions": 1536,
      "vectorSearchConfiguration": "vector-config"
    }
  ],
  "analyzers": [
    {
      "name": "custom_text_analyzer",
      "@odata.type": "#Microsoft.Azure.Search.CustomAnalyzer",
      "tokenizer": "standard_v2",
      "tokenFilters": [
        "lowercase",
        "asciifolding",
        "custom_stemmer",
        "custom_stopwords"
      ],
      "charFilters": ["html_strip"]
    }
  ],
  "tokenFilters": [
    {
      "name": "custom_stemmer",
      "@odata.type": "#Microsoft.Azure.Search.SnowballTokenFilter",
      "language": "english"
    },
    {
      "name": "custom_stopwords",
      "@odata.type": "#Microsoft.Azure.Search.StopwordsTokenFilter",
      "stopwords": ["the", "a", "an", "and", "or"],
      "ignoreCase": true
    }
  ],
  "vectorSearch": {
    "algorithmConfigurations": [
      {
        "name": "vector-config",
        "kind": "hnsw",
        "hnswParameters": {
          "metric": "cosine",
          "m": 4,
          "efConstruction": 400,
          "efSearch": 500
        }
      }
    ]
  },
  "scoringProfiles": [
    {
      "name": "boost-popular",
      "text": {
        "weights": {
          "name": 3,
          "description": 1,
          "tags": 2
        }
      },
      "functions": [
        {
          "type": "magnitude",
          "boost": 2,
          "fieldName": "rating",
          "interpolation": "linear",
          "magnitude": {
            "boostingRangeStart": 3,
            "boostingRangeEnd": 5,
            "constantBoostBeyondRange": true
          }
        },
        {
          "type": "freshness",
          "boost": 1.5,
          "fieldName": "createdAt",
          "interpolation": "logarithmic",
          "freshness": {
            "boostingDuration": "P30D"
          }
        }
      ],
      "functionAggregation": "sum"
    }
  ],
  "suggesters": [
    {
      "name": "product-suggester",
      "searchMode": "analyzingInfixMatching",
      "sourceFields": ["name", "tags"]
    }
  ]
}
```

## Cognitive Skills Pipeline

Create an AI enrichment pipeline for document processing:

```json
{
  "name": "document-skillset",
  "description": "Extract insights from documents",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Text.EntityRecognitionSkill",
      "name": "entity-recognition",
      "description": "Extract entities from text",
      "context": "/document",
      "categories": ["Person", "Organization", "Location", "Product"],
      "defaultLanguageCode": "en",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "persons",
          "targetName": "people"
        },
        {
          "name": "organizations",
          "targetName": "organizations"
        },
        {
          "name": "locations",
          "targetName": "locations"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.KeyPhraseExtractionSkill",
      "name": "key-phrase-extraction",
      "context": "/document",
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
      "@odata.type": "#Microsoft.Skills.Text.SentimentSkill",
      "name": "sentiment-analysis",
      "context": "/document",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "score",
          "targetName": "sentimentScore"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Vision.OcrSkill",
      "name": "ocr",
      "context": "/document/normalized_images/*",
      "detectOrientation": true,
      "inputs": [
        {
          "name": "image",
          "source": "/document/normalized_images/*"
        }
      ],
      "outputs": [
        {
          "name": "text",
          "targetName": "extractedText"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Custom.WebApiSkill",
      "name": "custom-classification",
      "uri": "https://my-function.azurewebsites.net/api/classify",
      "httpMethod": "POST",
      "timeout": "PT30S",
      "batchSize": 10,
      "context": "/document",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        },
        {
          "name": "keyPhrases",
          "source": "/document/keyPhrases"
        }
      ],
      "outputs": [
        {
          "name": "category",
          "targetName": "customCategory"
        },
        {
          "name": "confidence",
          "targetName": "categoryConfidence"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.MergeSkill",
      "name": "merge-content",
      "context": "/document",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        },
        {
          "name": "itemsToInsert",
          "source": "/document/normalized_images/*/extractedText"
        }
      ],
      "outputs": [
        {
          "name": "mergedText",
          "targetName": "mergedContent"
        }
      ]
    }
  ],
  "cognitiveServices": {
    "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
    "key": "<cognitive-services-key>"
  },
  "knowledgeStore": {
    "storageConnectionString": "<storage-connection>",
    "projections": [
      {
        "tables": [
          {
            "tableName": "documentsTable",
            "generatedKeyName": "documentKey",
            "source": "/document"
          },
          {
            "tableName": "entitiesTable",
            "generatedKeyName": "entityKey",
            "source": "/document/organizations/*"
          }
        ],
        "objects": [
          {
            "storageContainer": "enriched-documents",
            "source": "/document"
          }
        ]
      }
    ]
  }
}
```

## Advanced Search Queries

### Semantic Search with Vector Similarity

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery
from azure.core.credentials import AzureKeyCredential
import openai

search_client = SearchClient(
    endpoint="https://my-search.search.windows.net",
    index_name="products-index",
    credential=AzureKeyCredential("<api-key>")
)

def semantic_search(query_text, top_k=10):
    """
    Perform hybrid search combining full-text and vector similarity.
    """
    # Generate embedding for query
    embedding_response = openai.Embedding.create(
        input=query_text,
        model="text-embedding-ada-002"
    )
    query_vector = embedding_response["data"][0]["embedding"]

    # Hybrid search
    results = search_client.search(
        search_text=query_text,
        vector_queries=[
            VectorizedQuery(
                vector=query_vector,
                k_nearest_neighbors=50,
                fields="descriptionVector"
            )
        ],
        select=["id", "name", "description", "price", "rating"],
        top=top_k,
        query_type="semantic",
        semantic_configuration_name="my-semantic-config",
        query_caption="extractive",
        query_answer="extractive"
    )

    search_results = []
    for result in results:
        search_results.append({
            "id": result["id"],
            "name": result["name"],
            "description": result["description"],
            "price": result["price"],
            "rating": result["rating"],
            "score": result["@search.score"],
            "reranker_score": result.get("@search.reranker_score"),
            "captions": [c.text for c in result.get("@search.captions", [])]
        })

    # Get semantic answers
    answers = results.get_answers()
    if answers:
        for answer in answers:
            print(f"Answer: {answer.text} (score: {answer.score})")

    return search_results
```

### Complex Filtering and Faceting

```csharp
using Azure.Search.Documents;
using Azure.Search.Documents.Models;

public class ProductSearchService
{
    private readonly SearchClient _searchClient;

    public async Task<SearchResults> SearchProductsAsync(
        string searchText,
        SearchFilters filters,
        int page = 1,
        int pageSize = 20)
    {
        var options = new SearchOptions
        {
            Size = pageSize,
            Skip = (page - 1) * pageSize,
            IncludeTotalCount = true,
            QueryType = SearchQueryType.Full,
            SearchMode = SearchMode.All,
            ScoringProfile = "boost-popular",

            // Facets for filtering UI
            Facets =
            {
                "category,count:20",
                "tags,count:50",
                "price,values:0|25|50|100|200|500",
                "rating,values:1|2|3|4|5"
            },

            // Highlighting
            HighlightFields = { "name", "description" },
            HighlightPreTag = "<mark>",
            HighlightPostTag = "</mark>"
        };

        // Build filter expression
        var filterParts = new List<string>();

        if (filters.Categories?.Any() == true)
        {
            var categoryFilter = string.Join(" or ",
                filters.Categories.Select(c => $"category eq '{c}'"));
            filterParts.Add($"({categoryFilter})");
        }

        if (filters.MinPrice.HasValue)
        {
            filterParts.Add($"price ge {filters.MinPrice}");
        }

        if (filters.MaxPrice.HasValue)
        {
            filterParts.Add($"price le {filters.MaxPrice}");
        }

        if (filters.MinRating.HasValue)
        {
            filterParts.Add($"rating ge {filters.MinRating}");
        }

        if (filters.Tags?.Any() == true)
        {
            var tagFilters = filters.Tags.Select(t =>
                $"tags/any(tag: tag eq '{t}')");
            filterParts.Add($"({string.Join(" and ", tagFilters)})");
        }

        if (filters.Location != null && filters.RadiusKm.HasValue)
        {
            filterParts.Add(
                $"geo.distance(location, geography'POINT({filters.Location.Longitude} {filters.Location.Latitude})') le {filters.RadiusKm}");
        }

        if (filterParts.Any())
        {
            options.Filter = string.Join(" and ", filterParts);
        }

        // Sorting
        if (!string.IsNullOrEmpty(filters.SortBy))
        {
            options.OrderBy.Add(filters.SortBy switch
            {
                "price_asc" => "price asc",
                "price_desc" => "price desc",
                "rating" => "rating desc",
                "newest" => "createdAt desc",
                _ => "search.score() desc"
            });
        }

        var response = await _searchClient.SearchAsync<ProductDocument>(
            searchText,
            options);

        return new SearchResults
        {
            TotalCount = response.Value.TotalCount ?? 0,
            Products = await response.Value.GetResultsAsync()
                .Select(r => new ProductResult
                {
                    Product = r.Document,
                    Score = r.Score ?? 0,
                    Highlights = r.Highlights
                })
                .ToListAsync(),
            Facets = ParseFacets(response.Value.Facets)
        };
    }

    private Dictionary<string, List<FacetValue>> ParseFacets(
        IDictionary<string, IList<FacetResult>> facets)
    {
        var result = new Dictionary<string, List<FacetValue>>();

        foreach (var facet in facets)
        {
            result[facet.Key] = facet.Value
                .Select(f => new FacetValue
                {
                    Value = f.Value?.ToString(),
                    Count = f.Count ?? 0
                })
                .ToList();
        }

        return result;
    }
}
```

## Autocomplete and Suggestions

```typescript
import { SearchClient, AutocompleteMode } from "@azure/search-documents";

export class SearchSuggestionService {
    private searchClient: SearchClient;

    async getSuggestions(
        partialQuery: string,
        suggesterName: string = "product-suggester"
    ): Promise<Suggestion[]> {
        // Autocomplete for query completion
        const autocompleteResults = await this.searchClient.autocomplete(
            partialQuery,
            suggesterName,
            {
                mode: AutocompleteMode.TwoTerms,
                top: 5,
                minimumCoverage: 80
            }
        );

        // Suggestions for document results
        const suggestResults = await this.searchClient.suggest(
            partialQuery,
            suggesterName,
            {
                top: 5,
                select: ["id", "name", "category"],
                filter: "rating ge 4",
                highlightPreTag: "<b>",
                highlightPostTag: "</b>"
            }
        );

        return {
            queryCompletions: autocompleteResults.results.map(r => ({
                text: r.text,
                queryPlusText: r.queryPlusText
            })),
            documentSuggestions: suggestResults.results.map(r => ({
                id: r.document.id,
                name: r.document.name,
                category: r.document.category,
                highlightedName: r.text
            }))
        };
    }

    async fuzzySearch(query: string): Promise<SearchResult[]> {
        // Enable fuzzy matching for typo tolerance
        const results = await this.searchClient.search(query, {
            queryType: "full",
            searchFields: ["name", "description"],
            // Fuzzy search with edit distance of 1
            searchText: `${query}~1`,
            top: 10
        });

        return results;
    }
}
```

## Indexer with Change Detection

```json
{
  "name": "cosmos-products-indexer",
  "dataSourceName": "cosmos-products-datasource",
  "targetIndexName": "products-index",
  "skillsetName": "document-skillset",
  "schedule": {
    "interval": "PT5M",
    "startTime": "2021-01-01T00:00:00Z"
  },
  "parameters": {
    "maxFailedItems": 10,
    "maxFailedItemsPerBatch": 5,
    "configuration": {
      "assumeOrderByHighWaterMarkColumn": true,
      "parsingMode": "default"
    }
  },
  "fieldMappings": [
    {
      "sourceFieldName": "id",
      "targetFieldName": "id"
    },
    {
      "sourceFieldName": "productName",
      "targetFieldName": "name"
    },
    {
      "sourceFieldName": "_ts",
      "targetFieldName": "indexedTimestamp",
      "mappingFunction": {
        "name": "base64Encode"
      }
    }
  ],
  "outputFieldMappings": [
    {
      "sourceFieldName": "/document/keyPhrases",
      "targetFieldName": "tags"
    },
    {
      "sourceFieldName": "/document/sentimentScore",
      "targetFieldName": "sentimentScore"
    },
    {
      "sourceFieldName": "/document/customCategory",
      "targetFieldName": "aiCategory"
    }
  ]
}
```

## Best Practices

1. **Index Design**: Only make fields searchable/filterable/facetable when needed
2. **Analyzers**: Use language-specific analyzers for better relevance
3. **Scoring Profiles**: Tune scoring based on business requirements
4. **Caching**: Implement result caching for common queries
5. **Monitoring**: Track search metrics and zero-result queries
6. **Testing**: A/B test scoring profiles and relevance tuning

Azure Cognitive Search provides powerful capabilities for building intelligent search experiences. Combining full-text search with AI enrichment and vector similarity enables sophisticated discovery scenarios that were previously difficult to implement.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
