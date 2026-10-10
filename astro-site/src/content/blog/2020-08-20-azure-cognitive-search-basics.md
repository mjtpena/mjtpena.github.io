---
title: "Designing an Azure Cognitive Search Index with the v11 .NET SDK"
description: "How to size an Azure Cognitive Search service, design index fields you won't regret, and query safely with the newly GA Azure.Search.Documents v11 SDK."
author: Michael John Peña
draft: false
date: 2020-08-20
tags:
  - Azure
  - Cognitive Search
  - Search
  - .NET
  - C#
---

Most search projects that disappoint don't fail at query time. They fail at index design, when someone marks every field searchable, filterable and facetable "just in case", picks the wrong analyser, and then finds out that fixing it means dropping and rebuilding the index. Azure Cognitive Search (formerly Azure Search) is forgiving about almost everything except the shape of the index, so that is where I spend the design time.

The timing is good to revisit the .NET side too. [`Azure.Search.Documents` 11.0.0 went GA on 7 July 2020](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/search/Azure.Search.Documents/CHANGELOG.md), replacing the older `Microsoft.Azure.Search` v10 packages, and 11.1.0 (11 August) added `FieldBuilder`, which builds index fields from a C# model. Everything below targets 11.1.x against REST API version `2020-06-30`.

## Sizing the service before you write any code

The tier is the one decision you can't change in place. To move from Basic to Standard, or from S1 to S2, you create a new service and rebuild your indexes. So it is worth five minutes up front.

| Tier | What it's for | Storage per partition (2020) | Max replicas × partitions |
|---|---|---|---|
| Free | Tutorials and spikes; shared, no SLA | 50 MB total | n/a |
| Basic | Small production workloads | 2 GB | 3 replicas, 1 partition |
| S1 | Most line-of-business and catalogue search | 25 GB | 12 × 12 (36 search units max) |
| S2 / S3 | Large indexes or heavy query volume | 100 GB / 200 GB | 12 × 12 (36 SU max) |

The 2020 figures come from the [service limits page](https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity) (it has since been updated for higher-capacity services). Two things catch people out.

First, billing is in **search units**, and search units multiply: replicas × partitions. A Standard service with 3 replicas and 3 partitions is *9 search units*, not 6. It's easy to misread on a design and hard to explain on an invoice.

Second, replicas and partitions solve different problems. Partitions add storage and help indexing throughput. Replicas add query throughput and availability, and the SLA only applies once you have two replicas for read-only queries and three for read-write. A single-replica service has no SLA at all, which is fine for dev and test but not for a customer-facing search box.

My rule of thumb: start at S1 with one replica and one partition for any project where you aren't sure of the data volume, and only scale once you have real query numbers. Basic is fine when you know the index will stay small, but you can't grow out of it in place. That's the real trade-off: an S1 search unit costs roughly three times a Basic one, so defaulting to S1 means paying that premium every month for headroom you may never use, in exchange for never having to migrate. For production, go to two replicas before go-live, not after the first incident.

```bash
az group create --name rg-search --location australiaeast

az search service create \
    --name <your-search-service> \
    --resource-group rg-search \
    --location australiaeast \
    --sku standard \
    --partition-count 1 \
    --replica-count 1

# Admin key: for index management and indexing only
az search admin-key show \
    --service-name <your-search-service> \
    --resource-group rg-search

# Query key: what the front end or query API should use
az search query-key create \
    --name web-frontend \
    --service-name <your-search-service> \
    --resource-group rg-search
```

The data plane only supports API keys for now; there's no Azure AD authentication for queries. Treat that as a design constraint. The admin key can delete indexes, so it belongs in Key Vault and in your indexing job, never in a browser or a mobile app. Query keys are read-only and you can create up to 50 of them, so give each client its own and revoke them one by one.

## Designing the index fields

Every field attribute has a cost. `searchable` builds an inverted index of the field's tokens. `filterable`, `sortable` and `facetable` each keep extra structures. Turning them all on for every field inflates storage, which counts against your partition limit, and slows indexing. More importantly, you can add *new* fields to an existing index, but you [can't change an existing field's searchable, filterable, sortable or facetable attributes, or its indexing analyser](https://learn.microsoft.com/en-us/azure/search/search-howto-reindex), without rebuilding the index. (A few properties can be changed in place, such as `retrievable`, synonym maps, and `searchAnalyzer` on a field that was created with an `indexAnalyzer`/`searchAnalyzer` pair. A field set with the single `analyzer` property, as `AnalyzerName` does below, can't get a new search analyser without a rebuild. Setting `IndexAnalyzerName` and `SearchAnalyzerName` separately keeps that option open.)

So I go through each field and ask three questions:

- **Will people type words that should match this?** If so, it's searchable, and I choose the analyser now. For English product text, `en.microsoft` usually beats the default `standard.lucene` because it handles stemming and lemmatisation better ("batteries" matches "battery").
- **Will the UI narrow results by it, or sort on it?** Then it's filterable or sortable. Prices, dates, stock flags and categories usually are; long descriptions never are.
- **Does it drive a facet count in the sidebar?** Facetable is for low-cardinality values like category and brand. A facet on a free-text field produces useless buckets.

With 11.1, you can express those decisions as attributes on the model and let `FieldBuilder` produce the schema. The model then doubles as the document type for indexing and querying, which means one less place for field names to drift.

```csharp
using System;
using Azure.Search.Documents.Indexes;
using Azure.Search.Documents.Indexes.Models;

public class Product
{
    [SimpleField(IsKey = true, IsFilterable = true)]
    public string Id { get; set; }

    [SearchableField(IsSortable = true, AnalyzerName = LexicalAnalyzerName.Values.EnMicrosoft)]
    public string Name { get; set; }

    [SearchableField(AnalyzerName = LexicalAnalyzerName.Values.EnMicrosoft)]
    public string Description { get; set; }

    [SearchableField(IsFilterable = true, IsFacetable = true)]
    public string Category { get; set; }

    [SearchableField(IsFilterable = true, IsFacetable = true)]
    public string Brand { get; set; }

    [SimpleField(IsFilterable = true, IsSortable = true, IsFacetable = true)]
    public double? Price { get; set; }

    [SimpleField(IsFilterable = true, IsSortable = true)]
    public double? Rating { get; set; }

    [SimpleField(IsFilterable = true)]
    public bool? InStock { get; set; }

    [SearchableField(IsFilterable = true, IsFacetable = true)]
    public string[] Tags { get; set; }

    [SimpleField(IsFilterable = true, IsSortable = true)]
    public DateTimeOffset? LastUpdated { get; set; }
}
```

Use nullable value types for anything that might be missing in the source data; otherwise a missing price deserialises as `0` and quietly sorts to the top of "cheapest first".

### Plan the suggester on day one (and add a scoring profile while you're there)

One index feature has to be planned on day one. A [suggester](https://learn.microsoft.com/en-us/azure/search/index-add-suggesters) can only use fields that exist when it's created, so if you add autocomplete later on an existing field, you're rebuilding. A scoring profile can be added later, but it's cheap to start with one and it makes relevance tuning a configuration change instead of a code change.

```csharp
using System;
using System.Threading.Tasks;
using Azure;
using Azure.Search.Documents.Indexes;
using Azure.Search.Documents.Indexes.Models;

public static class IndexSetup
{
    public static async Task CreateProductIndexAsync(Uri endpoint, string adminKey)
    {
        var indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(adminKey));

        var index = new SearchIndex("products", new FieldBuilder().Build(typeof(Product)))
        {
            Suggesters = { new SearchSuggester("sg", "Name", "Brand", "Category") },
            ScoringProfiles =
            {
                new ScoringProfile("boost-rating")
                {
                    FunctionAggregation = ScoringFunctionAggregation.Sum,
                    Functions =
                    {
                        new MagnitudeScoringFunction("Rating", 2,
                            new MagnitudeScoringParameters(0, 5) { ShouldBoostBeyondRangeByConstant = true })
                    }
                }
            }
        };

        await indexClient.CreateOrUpdateIndexAsync(index);
    }
}
```

The scoring profile gives higher-rated products a modest boost on top of text relevance. Keep boosts small. A boost of 10 on rating means a five-star product that barely mentions "kettle" outranks the kettle the user was looking for.

## Pushing documents and checking every result

There are two ways to get data in: push it from your code, or let an indexer pull it from Azure SQL, Cosmos DB or Blob Storage on a schedule. Push gives you control over timing and transformation, and it works with any source, including ones an indexer can't reach. Indexers save you writing a sync job. Push is the wrong choice when the data already sits in Azure SQL, Cosmos DB or Blob Storage and the source supports change tracking: an indexer picks up the changes on a schedule, and you've removed a job you'd otherwise have to build, monitor and retry yourself. I'd only push from those sources when I need to reshape the data in ways the indexer can't, or need changes visible faster than the five-minute minimum schedule. I'll cover the pull model [in a separate post on indexers](/blog/2020-09-01-azure-cognitive-search-indexers/).

For push, the trap is that a batch can partly succeed. A partly failed batch comes back as `207 Multi-Status`, not an error. With `ThrowOnAnyError = false` the SDK won't throw, so check each `IndexingResult`.

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Azure.Search.Documents;
using Azure.Search.Documents.Models;

public static class ProductIndexer
{
    private const int MaxAttempts = 4;

    // Keep batches at or under 1,000 documents (and well under 16 MB).
    public static async Task UploadAsync(SearchClient adminClient, IReadOnlyList<Product> products)
    {
        foreach (var chunk in products.Select((p, i) => (p, i)).GroupBy(x => x.i / 1000))
        {
            List<Product> pending = chunk.Select(x => x.p).ToList();

            for (int attempt = 1; attempt <= MaxAttempts && pending.Count > 0; attempt++)
            {
                if (attempt > 1)
                {
                    // Exponential back-off: 2, 4, 8 seconds.
                    await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)));
                }

                var batch = IndexDocumentsBatch.MergeOrUpload(pending);
                var response = await adminClient.IndexDocumentsAsync(batch,
                    new IndexDocumentsOptions { ThrowOnAnyError = false });

                var retryKeys = new HashSet<string>();
                foreach (var failed in response.Value.Results.Where(r => !r.Succeeded))
                {
                    if ((failed.Status == 503 || failed.Status == 409 || failed.Status == 422) && attempt < MaxAttempts)
                    {
                        retryKeys.Add(failed.Key);
                    }
                    else
                    {
                        Console.WriteLine($"{failed.Key}: {failed.Status} {failed.ErrorMessage}");
                    }
                }

                // Only the transient failures go round again.
                pending = pending.Where(p => retryKeys.Contains(p.Id)).ToList();
            }
        }
    }
}
```

`MergeOrUpload` is the safest default for sync jobs: it inserts new documents and merges into existing ones. Be careful what "merge" means here, though. With a typed model every property is sent, so a null in the source overwrites the indexed value. If you need a true partial update, send a smaller type or a `SearchDocument` containing only the changed fields. Per-document `503`s usually mean throttling, and `409` and `422` are also transient, so the loop retries those keys with back-off rather than failing the whole run. A `400` for a malformed document won't fix itself, so it's logged instead. Whole-request failures (a `503` for the entire batch) are already retried by the SDK's default pipeline policy.

## Querying without building an injection hole

The most common bug I see in search code is a filter built with string interpolation: `$"Brand eq '{brand}'"`. A brand like `O'Reilly` breaks the query, and a crafted value can change what the filter means. The v11 SDK includes `SearchFilter.Create`, which takes a formattable string and escapes values properly for OData.

```csharp
using System.Collections.Generic;
using System.Threading.Tasks;
using Azure.Search.Documents;
using Azure.Search.Documents.Models;

public static class ProductSearch
{
    public static async Task<SearchResults<Product>> SearchAsync(
        SearchClient queryClient, string text, string brand, double? maxPrice, int page, int pageSize)
    {
        var filters = new List<string> { "InStock eq true" };
        if (!string.IsNullOrEmpty(brand)) filters.Add(SearchFilter.Create($"Brand eq {brand}"));
        if (maxPrice.HasValue) filters.Add(SearchFilter.Create($"Price le {maxPrice.Value}"));

        var options = new SearchOptions
        {
            Filter = string.Join(" and ", filters),
            ScoringProfile = "boost-rating",
            IncludeTotalCount = true,
            Skip = (page - 1) * pageSize,
            Size = pageSize
        };
        options.Select.Add("Id");
        options.Select.Add("Name");
        options.Select.Add("Price");
        options.Select.Add("Rating");
        options.Facets.Add("Category,count:10");
        options.Facets.Add("Brand,count:10");
        options.Facets.Add("Price,values:50|100|200|500");
        options.HighlightFields.Add("Description");

        return (await queryClient.SearchAsync<Product>(string.IsNullOrWhiteSpace(text) ? "*" : text, options)).Value;
    }

    public static async Task<IReadOnlyList<SearchSuggestion<Product>>> SuggestAsync(SearchClient queryClient, string partial)
    {
        var options = new SuggestOptions { UseFuzzyMatching = true, Size = 5 };
        options.Select.Add("Id");
        options.Select.Add("Name");
        return (await queryClient.SuggestAsync<Product>(partial, "sg", options)).Value.Results;
    }
}
```

A few choices in there are deliberate. `Select` keeps payloads small; returning the full description for 50 results is wasted bandwidth. `IncludeTotalCount` has a cost on large indexes, so only ask for it when the UI shows "1,234 results". And `Skip` is capped at 100,000, so deep paging isn't a design pattern you can rely on. If users need to walk the whole catalogue, give them filters, not page 4,000.

Suggestions return matching *documents* (good for "jump to product" dropdowns), while `AutocompleteAsync` completes *terms* (good for finishing the query the user is typing). Pick one per UI element. Running both on every keystroke doubles your query load for little gain.

## When I wouldn't use it

Cognitive Search is a dedicated, always-on service, and you pay for its search units whether anyone queries it or not. That makes it a poor fit when:

- **The data already lives in Azure SQL and the "search" is a few `LIKE` filters on a small table.** SQL Server full-text search may be enough, and it avoids a second copy of the data to keep in sync.
- **You need the index to be the system of record.** It isn't transactional and it's eventually consistent with your source. Always be able to rebuild it from somewhere else.
- **Results must be strictly security-trimmed per user** and you're not prepared to maintain a filterable permissions field on every document. There's no built-in document-level security, so trimming is your filter's job.

When the requirement really is relevance-ranked text search with facets, typo tolerance and language-aware matching, I'd reach for it first.

## The short version

Spend your design time on the index, not the query code. Decide each field's attributes and analyser deliberately, put the suggester in version one, start at S1 with one replica and one partition, and remember that search units are replicas *times* partitions. On the .NET side, move to `Azure.Search.Documents` 11.1 now: `FieldBuilder` keeps the schema next to the model, and `SearchFilter.Create` removes a whole class of filter bugs. The [Microsoft Learn guide to the v11 SDK](https://learn.microsoft.com/en-us/azure/search/search-how-to-dotnet-sdk) covers the rest of the client surface.
