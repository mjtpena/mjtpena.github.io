---
title: "Relevance Tuning in Azure Cognitive Search: Analyzers to Scoring"
description: "How to tune Azure Cognitive Search relevance with BM25 settings, custom analyzers, synonym maps, scoring profiles and query syntax, and when to leave defaults."
author: Michael John Pena
draft: false
date: 2021-01-27
url: /blog/azure-cognitive-search-advanced/
tags:
  - Azure
  - Cognitive Search
  - Search
  - Azure Cognitive Search
---

A default Azure Cognitive Search index gets you to "decent enough" quickly. Getting from decent to good is a tuning exercise, and most of the levers sit in the index definition rather than in your application code: how text is tokenised, which words count as the same word, and which business signals should outweigh raw term matching. These are the relevance levers I reach for once the default index stops cutting it, in the order I'd pull them, and when I'd leave each one alone.

If you're new to the service, start with [building search solutions with Azure Cognitive Search](/blog/2020-08-20-azure-cognitive-search-basics/). If your problem is that the content itself is unstructured (scanned PDFs, images), relevance tuning won't save you; you need enrichment first, which I covered in [AI-powered skillsets](/blog/2020-11-14-azure-cognitive-search-skills/).

## Measure before you tune

The mistake I see most often is someone adding a scoring profile because one query looked wrong in a demo. Most relevance changes are global. Make a profile the default, or boost a field in a profile every query uses, and you quietly change the ranking of every other query.

Before touching anything, collect a set of real queries with the results you expect for each. Fifty is enough to start. With the [search traffic analytics](https://learn.microsoft.com/previous-versions/azure/search/search-traffic-analytics) pattern, your application logs each query, its result count and the result the user clicks to Application Insights, which gives you the queries people actually type, the ones that return zero results, and which results get clicked. Zero-result queries are the cheapest signal you'll ever get: they usually point at a vocabulary gap (synonyms) or a tokenisation problem (analyzers), not a ranking problem.

## Know which ranking algorithm you have

Cognitive Search scores keyword matches with one of two similarity algorithms. Services created after 15 July 2020 use BM25, and it's the only option on those services. Older services default to the classic TF-IDF similarity and can opt into BM25 per index, but only when the index is created, which means a rebuild for an existing index. The details are in [configure the similarity ranking algorithm](https://learn.microsoft.com/azure/search/index-ranking-similarity).

This matters for two reasons. First, if you're comparing results between a dev service created last month and a production service from 2019, they may not be running the same algorithm, and no amount of profile tuning will make them agree. Second, BM25 exposes two parameters you can set on the index:

- `k1` (default 1.2) controls how quickly repeated occurrences of a term stop adding to the score.
- `b` (default 0.75) controls how much a long document is penalised relative to a short one.

My rule of thumb: leave both at their defaults unless you have a measured problem with document length. A catalogue where short product names compete with long descriptions in the same field is the classic case for lowering `b`. Changing either value also requires the index to be rebuilt or updated with `allowIndexDowntime`, so treat it as a schema change, not a query tweak.

## Analyzers: fix tokenisation before ranking

Every searchable string field is run through an analyzer at indexing time and again at query time. If "Wi-Fi" is indexed as two tokens and the user types "wifi", no scoring profile will rescue that match. Analyzers are the first lever because they decide what can match at all.

The built-in options cover most cases. The default is the standard Lucene analyzer. The language analyzers (`en.microsoft`, `en.lucene`) add stemming and stop words, and the Microsoft ones also handle lemmatisation, so "running" and "ran" both match "run". For English product and document search I start with `en.microsoft` on descriptive fields and the standard analyzer on names and codes.

A [custom analyzer](https://learn.microsoft.com/azure/search/index-add-custom-analyzers) earns its place when your content has domain conventions the built-ins get wrong: HTML in descriptions, accented characters from supplier feeds, part numbers that must stay whole. Here is an index fragment with a custom analyzer, a BM25 configuration, and a synonym map reference, using the GA `2020-06-30` REST API. The index references a synonym map, so create the `product-synonyms` map (shown in the next section) before you create this index, or the request fails:

```json
{
  "name": "products-index",
  "fields": [
    { "name": "id", "type": "Edm.String", "key": true, "searchable": false },
    { "name": "name", "type": "Edm.String", "searchable": true, "analyzer": "standard.lucene", "synonymMaps": ["product-synonyms"] },
    { "name": "description", "type": "Edm.String", "searchable": true, "analyzer": "description_analyzer", "synonymMaps": ["product-synonyms"] },
    { "name": "tags", "type": "Collection(Edm.String)", "searchable": true, "filterable": true, "facetable": true, "synonymMaps": ["product-synonyms"] },
    { "name": "category", "type": "Edm.String", "searchable": false, "filterable": true, "facetable": true },
    { "name": "rating", "type": "Edm.Double", "filterable": true, "sortable": true },
    { "name": "createdAt", "type": "Edm.DateTimeOffset", "filterable": true, "sortable": true }
  ],
  "analyzers": [
    {
      "name": "description_analyzer",
      "@odata.type": "#Microsoft.Azure.Search.CustomAnalyzer",
      "charFilters": ["html_strip", "wifi_mapping"],
      "tokenizer": "standard_v2",
      "tokenFilters": ["lowercase", "asciifolding", "english_stemmer"]
    }
  ],
  "charFilters": [
    {
      "name": "wifi_mapping",
      "@odata.type": "#Microsoft.Azure.Search.MappingCharFilter",
      "mappings": ["Wi-Fi=>WiFi", "wi-fi=>wifi"]
    }
  ],
  "tokenFilters": [
    {
      "name": "english_stemmer",
      "@odata.type": "#Microsoft.Azure.Search.StemmerTokenFilter",
      "language": "lightEnglish"
    }
  ],
  "similarity": {
    "@odata.type": "#Microsoft.Azure.Search.BM25Similarity",
    "k1": 1.2,
    "b": 0.75
  }
}
```

Two trade-offs to know before you commit. An analyzer can't be changed on an existing field; you add a new field or rebuild the index. And the stemmer here is deliberately the light English stemmer: aggressive stemming raises recall but starts conflating words that aren't related, which shows up as "why is this in my results?" complaints.

Always test an analyzer with the Analyze Text API before indexing anything. It shows you the exact tokens produced, which settles most relevance arguments in a minute. Run the call below with `"analyzer": "standard.lucene"` and you'll see "Wi-Fi" come back as two tokens, `wi` and `fi`, which is exactly why a query for "wifi" misses. The `wifi_mapping` char filter above fixes that by rewriting the hyphenated form before the tokenizer sees it. Mappings are literal and case-sensitive, so list each spelling your content uses; for a handful of terms like this, a synonym rule such as `wifi, wi-fi` is the lighter alternative:

```http
POST https://<your-service-name>.search.windows.net/indexes/products-index/analyze?api-version=2020-06-30
Content-Type: application/json
api-key: <your-admin-key>

{
  "text": "<p>Café-grade Wi-Fi espresso machines</p>",
  "analyzer": "description_analyzer"
}
```

## Synonyms: close the vocabulary gap

Your catalogue says "trainers", your customers type "sneakers" or "runners". A [synonym map](https://learn.microsoft.com/azure/search/search-synonyms) expands the query at search time so both terms match, with no reindexing of documents. Synonym maps are a service-level object in Solr format, and each searchable field can reference one. Synonyms only expand queries on fields that reference the map, which is why the index above attaches `product-synonyms` to `name` and `description` as well as `tags`:

```http
PUT https://<your-service-name>.search.windows.net/synonymmaps/product-synonyms?api-version=2020-06-30
Content-Type: application/json
api-key: <your-admin-key>

{
  "name": "product-synonyms",
  "format": "solr",
  "synonyms": "trainers, sneakers, runners\nhoodie, hooded sweatshirt\ntee => t-shirt"
}
```

Comma-separated lines are equivalent terms, expanded in both directions. The `=>` form is one-way: a query for "tee" becomes "t-shirt", but not the reverse. I prefer synonyms over custom analyzers for vocabulary problems because the map can be updated without rebuilding the index. The catch is ownership. A synonym list that nobody maintains turns into a pile of guesses, so tie it to the zero-result queries from your analytics and review it on a schedule.

## Scoring profiles: add business signals deliberately

Once matching is right, [scoring profiles](https://learn.microsoft.com/azure/search/index-add-scoring-profiles) let you blend in signals that have nothing to do with text: rating, recency, distance, or whether a document carries a tag the user cares about. A profile has two parts. Field weights say a match in `name` is worth more than a match in `description`. Functions add boosts from numeric, date, geographic, or tag fields.

```json
{
  "scoringProfiles": [
    {
      "name": "boost-relevant-products",
      "text": {
        "weights": { "name": 3, "tags": 2, "description": 1 }
      },
      "functions": [
        {
          "type": "magnitude",
          "fieldName": "rating",
          "boost": 2,
          "interpolation": "linear",
          "magnitude": { "boostingRangeStart": 3, "boostingRangeEnd": 5, "constantBoostBeyondRange": true }
        },
        {
          "type": "freshness",
          "fieldName": "createdAt",
          "boost": 1.5,
          "interpolation": "linear",
          "freshness": { "boostingDuration": "P30D" }
        },
        {
          "type": "tag",
          "fieldName": "tags",
          "boost": 2,
          "tag": { "tagsParameter": "preferredTags" }
        }
      ],
      "functionAggregation": "sum"
    }
  ]
}
```

This JSON belongs in the same index definition as the fields above. The tag function is the one people overlook: it boosts documents whose `tags` overlap with values you pass at query time, which gives you a lightweight form of personalisation without a recommendation engine.

The caution with profiles is that boosts are multiplicative on top of the text score and interact with each other. Start with one function, measure against your query set, then add the next. A profile with five functions tuned by eye is almost impossible to reason about six months later. And don't use a freshness boost on content where age doesn't matter. A policy document from 2018 that's still current shouldn't lose to a newsletter from last week.

## Query syntax: give power users power

The query side has levers too. The simple syntax is forgiving and the right default for a public search box. The full Lucene syntax (`queryType=full`) adds fuzzy matching (`espresso~1`), proximity (`"coffee grinder"~3`), per-term boosting (`grinder^2`), and field-scoped search. `searchMode=all` requires every term to match, which tightens precision at the cost of more zero-result queries.

Here's the query side with the `azure-search-documents` 11.x Python library, which has been GA since July 2020:

```python
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient

search_client = SearchClient(
    endpoint="https://<your-service-name>.search.windows.net",
    index_name="products-index",
    credential=AzureKeyCredential("<your-query-key>"),
)

results = search_client.search(
    search_text="espresso~1 grinder^2",
    query_type="full",
    search_mode="any",
    scoring_profile="boost-relevant-products",
    scoring_parameters=["preferredTags-barista,commercial"],
    filter="rating ge 3",
    facets=["category,count:10"],
    include_total_count=True,
    top=10,
)

print(f"Total matches: {results.get_count()}")
for result in results:
    print(f"{result['@search.score']:.3f}  {result['name']}")

for facet in results.get_facets()["category"]:
    print(f"{facet['value']}: {facet['count']}")
```

Filters don't affect scoring; they only include or exclude documents. That makes them the right tool for hard constraints (in stock, region, permissions) and the wrong tool for "prefer". If you find yourself writing complicated OR filters to nudge ranking, that logic belongs in a scoring profile.

## Which lever, when

| Symptom | Lever | Needs a rebuild? |
|---|---|---|
| Expected document doesn't match at all | Analyzer | Yes, for that field |
| Users and content use different words | Synonym map | No |
| Right documents, wrong order | Scoring profile or field weights | No |
| Long documents dominate | BM25 `b` parameter | Yes, or update with downtime |
| Typos in queries | Full Lucene fuzzy search | No |

## Where I'd draw the line

Work from matching to ranking: analyzers and synonyms first, scoring profiles second, query syntax for the edge cases. Analyzers, synonym maps and any default scoring profile apply to every query, so tune against a fixed set of real queries and change one thing at a time.

Also know when to stop. If your users ask questions in natural language and expect the engine to understand intent rather than terms, keyword relevance tuning has a ceiling, and no combination of boosts will get you past it. For keyword search over a catalogue, a document library, or an intranet, though, the levers above are where the real gains are, and most teams leave them untouched.
