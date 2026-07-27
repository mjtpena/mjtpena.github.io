---
title: "Building Search Solutions with Azure Cognitive Search"
author: Michael John Peña
draft: false
date: 2020-08-20
tags:
  - Azure
  - Cognitive Search
  - Search
  - AI

---

I wrote "Building Search Solutions with Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## Creating a Search Service

```bash
# Create a search service
az search service create \
    --name search-myapp-2020 \
    --resource-group rg-search \
    --location australiaeast \
    --sku Standard \
    --partition-count 1 \
    --replica-count 1

# Get the admin key
az search admin-key show \
    --service-name search-myapp-2020 \
    --resource-group rg-search
```

## Setting Up with .NET SDK

```bash
dotnet add package Azure.Search.Documents
```

## Creating an Index

```csharp
using Azure;
using Azure.Search.Documents;
using Azure.Search.Documents.Indexes;
using Azure.Search.Documents.Indexes.Models;

public class SearchIndexManager
{
    private readonly SearchIndexClient _indexClient;

    public SearchIndexManager(string endpoint, string adminKey)
    {
        var credential = new AzureKeyCredential(adminKey);
        _indexClient = new SearchIndexClient(new Uri(endpoint), credential);
    }

    public async Task CreateProductIndexAsync()
    {
        var index = new SearchIndex("products")
        {
            Fields =
            {
                new SimpleField("id", SearchFieldDataType.String) { IsKey = true },
                new SearchableField("name") { IsFilterable = true, IsSortable = true },
                new SearchableField("description") { AnalyzerName = LexicalAnalyzerName.EnMicrosoft },
                new SearchableField("category") { IsFilterable = true, IsFacetable = true },
                new SearchableField("brand") { IsFilterable = true, IsFacetable = true },
                new SimpleField("price", SearchFieldDataType.Double) { IsFilterable = true, IsSortable = true, IsFacetable = true },
                new SimpleField("rating", SearchFieldDataType.Double) { IsFilterable = true, IsSortable = true },
                new SimpleField("inStock", SearchFieldDataType.Boolean) { IsFilterable = true },
                new SearchableField("tags", collection: true) { IsFilterable = true, IsFacetable = true },
                new SimpleField("lastUpdated", SearchFieldDataType.DateTimeOffset) { IsFilterable = true, IsSortable = true }
            },
            Suggesters =
            {
                new SearchSuggester("sg", "name", "category", "brand")
            },
            ScoringProfiles =
            {
                new ScoringProfile("boost-rating")
                {
                    FunctionAggregation = ScoringFunctionAggregation.Sum,
                    Functions =
                    {
                        new MagnitudeScoringFunction(
                            fieldName: "rating",
                            boost: 2,
                            parameters: new MagnitudeScoringParameters(0, 5)
                            {
                                ShouldBoostBeyondRangeByConstant = true
                            })
                    }
                }
            }
        };

        await _indexClient.CreateOrUpdateIndexAsync(index);
    }
}
```

## Indexing Documents

```csharp
public class ProductIndexer
{
    private readonly SearchClient _searchClient;

    public ProductIndexer(string endpoint, string adminKey, string indexName)
    {
        var credential = new AzureKeyCredential(adminKey);
        _searchClient = new SearchClient(new Uri(endpoint), indexName, credential);
    }

    public async Task IndexProductsAsync(IEnumerable<Product> products)
    {
        var documents = products.Select(p => new
        {
            id = p.Id,
            name = p.Name,
            description = p.Description,
            category = p.Category,
            brand = p.Brand,
            price = p.Price,
            rating = p.Rating,
            inStock = p.InStock,
            tags = p.Tags,
            lastUpdated = p.LastUpdated
        });

        var batch = IndexDocumentsBatch.Upload(documents);
        var result = await _searchClient.IndexDocumentsAsync(batch);

        Console.WriteLine($"Indexed {result.Value.Results.Count} documents");

        foreach (var r in result.Value.Results.Where(r => !r.Succeeded))
        {
            Console.WriteLine($"Failed to index document {r.Key}: {r.ErrorMessage}");
        }
    }

    public async Task DeleteProductAsync(string productId)
    {
        var batch = IndexDocumentsBatch.Delete("id", new[] { productId });
        await _searchClient.IndexDocumentsAsync(batch);
    }
}
```

## Searching Documents

```csharp
public class ProductSearchService
{
    private readonly SearchClient _searchClient;

    public ProductSearchService(string endpoint, string queryKey, string indexName)
    {
        var credential = new AzureKeyCredential(queryKey);
        _searchClient = new SearchClient(new Uri(endpoint), indexName, credential);
    }

    public async Task<SearchResult> SearchProductsAsync(SearchRequest request)
    {
        var options = new SearchOptions
        {
            Filter = BuildFilter(request),
            OrderBy = { request.SortBy ?? "search.score() desc" },
            Skip = (request.Page - 1) * request.PageSize,
            Size = request.PageSize,
            IncludeTotalCount = true,
            Facets = { "category,count:10", "brand,count:10", "price,values:50|100|200|500" },
            HighlightFields = { "name", "description" },
            ScoringProfile = "boost-rating"
        };

        // Select specific fields
        options.Select.Add("id");
        options.Select.Add("name");
        options.Select.Add("description");
        options.Select.Add("price");
        options.Select.Add("rating");
        options.Select.Add("category");

        var response = await _searchClient.SearchAsync<ProductDocument>(request.Query, options);

        var result = new SearchResult
        {
            TotalCount = response.Value.TotalCount ?? 0,
            Facets = ExtractFacets(response.Value.Facets),
            Products = new List<ProductSearchResult>()
        };

        await foreach (var searchResult in response.Value.GetResultsAsync())
        {
            result.Products.Add(new ProductSearchResult
            {
                Id = searchResult.Document.Id,
                Name = searchResult.Document.Name,
                Description = searchResult.Document.Description,
                Price = searchResult.Document.Price,
                Rating = searchResult.Document.Rating,
                Score = searchResult.Score ?? 0,
                Highlights = searchResult.Highlights
            });
        }

        return result;
    }

    private string BuildFilter(SearchRequest request)
    {
        var filters = new List<string>();

        if (!string.IsNullOrEmpty(request.Category))
            filters.Add($"category eq '{request.Category}'");

        if (!string.IsNullOrEmpty(request.Brand))
            filters.Add($"brand eq '{request.Brand}'");

        if (request.MinPrice.HasValue)
            filters.Add($"price ge {request.MinPrice}");

        if (request.MaxPrice.HasValue)
            filters.Add($"price le {request.MaxPrice}");

        if (request.InStockOnly)
            filters.Add("inStock eq true");

        return filters.Any() ? string.Join(" and ", filters) : null;
    }
}
```

## Autocomplete and Suggestions

```csharp
public async Task<List<string>> GetSuggestionsAsync(string searchText)
{
    var options = new SuggestOptions
    {
        UseFuzzyMatching = true,
        Size = 5
    };

    var response = await _searchClient.SuggestAsync<ProductDocument>(searchText, "sg", options);

    return response.Value.Results.Select(r => r.Text).ToList();
}

public async Task<List<string>> GetAutocompleteAsync(string searchText)
{
    var options = new AutocompleteOptions
    {
        Mode = AutocompleteMode.OneTermWithContext,
        Size = 5
    };

    var response = await _searchClient.AutocompleteAsync(searchText, "sg", options);

    return response.Value.Results.Select(r => r.Text).ToList();
}
```

## AI Enrichment with Skillsets

Create a skillset for cognitive enrichment:

```csharp
public async Task CreateSkillsetAsync()
{
    var skillset = new SearchIndexerSkillset("document-skillset", new List<SearchIndexerSkill>
    {
        new OcrSkill(
            inputs: new[] { new InputFieldMappingEntry("image") { Source = "/document/normalized_images/*" } },
            outputs: new[] { new OutputFieldMappingEntry("text") { TargetName = "ocrText" } })
        {
            DefaultLanguageCode = OcrSkillLanguage.En
        },
        new KeyPhraseExtractionSkill(
            inputs: new[] { new InputFieldMappingEntry("text") { Source = "/document/content" } },
            outputs: new[] { new OutputFieldMappingEntry("keyPhrases") { TargetName = "keyPhrases" } })
        {
            DefaultLanguageCode = KeyPhraseExtractionSkillLanguage.En
        },
        new EntityRecognitionSkill(
            inputs: new[] { new InputFieldMappingEntry("text") { Source = "/document/content" } },
            outputs: new[] { new OutputFieldMappingEntry("organizations") { TargetName = "organizations" } })
        {
            Categories = { EntityCategory.Organization, EntityCategory.Person, EntityCategory.Location }
        }
    });

    var indexerClient = new SearchIndexerClient(new Uri(endpoint), credential);
    await indexerClient.CreateOrUpdateSkillsetAsync(skillset);
}
```

Azure Cognitive Search provides powerful search capabilities that can transform how users find and discover content in your applications.

The pricing nuance worth knowing: search units multiply (replicas × partitions). A 3-replica, 3-partition Standard service is *9 search units*, not 6. Easy to misread, hard to explain on an invoice. Start at S1 with a single replica/partition for any project, and only scale up once you have real query volume to justify it.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
