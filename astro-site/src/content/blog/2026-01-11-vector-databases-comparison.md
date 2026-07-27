---
title: "Vector Databases: What I Learned From Using 5 Different Ones"
author: Michael John Peña
draft: false
date: 2026-01-11
tags:
  - AI
  - Vector
  - Database
  - Azure
---

I've deployed vector databases for RAG systems across 5 different projects. Each project chose a different solution. Here's what I actually learned.

## What I've Used

1. Azure AI Search (formerly Cognitive Search)
2. Azure Cosmos DB (MongoDB vCore with vector)
3. PostgreSQL with pgvector
4. Pinecone
5. Redis with vector search

Each has trade-offs. None is perfect for everything.

## Azure AI Search

**Best for:** All-in-one RAG systems on Azure

**Pros:**
- Native Azure integration
- Hybrid search built-in (vector + keyword)
- Semantic ranking included
- Good monitoring and logging
- Handles indexing for you

**Cons:**
- Can get expensive at scale
- Less control over vector algorithm
- Somewhat slower than specialized solutions
- Limited to Azure ecosystem

**When I use it:** Client wants fully managed, integrated with Azure services, doesn't want to manage infrastructure.

**Real cost:** ~$300/month for 1M vectors with S1 tier.

## Cosmos DB with MongoDB vCore

**Best for:** Global distribution needs

**Pros:**
- Global replication built-in
- Familiar MongoDB interface
- Good Azure integration
- Scales horizontally well

**Cons:**
- More expensive than alternatives
- Vector search is newer, less mature
- Query performance varies
- Can be complex to optimize

**When I use it:** App needs global distribution, already using Cosmos DB, willing to pay for convenience.

**Real cost:** ~$500/month for similar workload.

## PostgreSQL + pgvector

**Best for:** Cost-conscious projects with SQL needs

**Pros:**
- It's PostgreSQL—reliable, well-understood
- Cheap (can run on existing infrastructure)
- SQL queries alongside vector search
- Mature ecosystem
- Full control

**Cons:**
- You manage everything
- Scaling requires work
- Performance optimization is manual
- Less optimized for pure vector workloads

**When I use it:** Budget-constrained, team knows PostgreSQL, already have relational data.

**Real cost:** ~$50/month on managed PostgreSQL.

## Pinecone

**Best for:** Purpose-built vector search

**Pros:**
- Fast. Really fast.
- Purpose-built for vectors
- Simple API
- Good filtering
- Handles scale well

**Cons:**
- Another service to manage
- Vendor lock-in concerns
- Can get expensive
- Less flexibility than general databases

**When I use it:** Performance is critical, budget allows for specialized service, don't need co-located data.

**Real cost:** ~$200/month for p1 pod.

## Redis Vector Search

**Best for:** Low-latency, cached searches

**Pros:**
- Extremely fast
- Already using Redis for caching
- Simple to add vectors to existing Redis
- Good for real-time applications
- Affordable

**Cons:**
- In-memory costs add up at scale
- Not designed for massive vector storage
- Limited advanced features
- Less mature than alternatives

**When I use it:** Low-latency requirements, smaller datasets, already have Redis infrastructure.

**Real cost:** ~$100/month added to existing Redis.

## The Real Comparison

Let me share actual numbers from a production RAG system with 500K documents:

| Solution | Search Latency | Index Time | Monthly Cost | Setup Complexity |
|----------|---------------|------------|--------------|------------------|
| AI Search | 150-300ms | 2 hours | $300 | Low |
| Cosmos DB | 200-400ms | 3 hours | $500 | Medium |
| PostgreSQL | 100-200ms | 1 hour | $50 | Medium |
| Pinecone | 50-100ms | 30 mins | $200 | Low |
| Redis | 20-50ms | 15 mins | $100 | Low |

These are approximate. Your mileage will vary.

## What Actually Matters

After deploying these systems, here's what I've learned matters:

### 1. Query Performance vs. Storage Size

Different databases scale differently:
- **Redis:** Fast queries, expensive storage
- **PostgreSQL:** Moderate queries, cheap storage
- **Pinecone:** Fast queries, moderate storage cost
- **AI Search:** Moderate queries, expensive storage
- **Cosmos DB:** Variable queries, expensive storage

### 2. Integration Complexity

**Easiest integration:**
1. Azure AI Search (if on Azure)
2. Redis (if already using it)
3. PostgreSQL (if using PostgreSQL)
4. Pinecone
5. Cosmos DB

### 3. Filtering Capabilities

Not all vector databases handle filters equally:

**Strong filtering:** AI Search, Cosmos DB, PostgreSQL
**Moderate filtering:** Pinecone
**Weak filtering:** Redis

If you need complex filters alongside vector search, choose accordingly.

### 4. Hybrid Search

**Native hybrid search:**
- Azure AI Search (excellent)
- PostgreSQL (good with tsvector)

**Roll your own:**
- Pinecone (need separate BM25)
- Redis (need separate full-text)
- Cosmos DB (possible but complex)

## My Decision Framework

When starting a new project, I ask:

**1. What's already in the stack?**
- Using Azure heavily? → AI Search
- Using PostgreSQL? → pgvector
- Using Redis? → Redis vectors
- Using MongoDB? → Cosmos DB

**2. What's the budget?**
- Tight budget → PostgreSQL
- Moderate budget → Redis or Pinecone
- Flexible budget → AI Search or Cosmos DB

**3. What's the scale?**
- < 100K vectors → Any will work
- 100K - 1M vectors → PostgreSQL, Pinecone, or AI Search
- > 1M vectors → Pinecone or AI Search with partitioning

**4. What's the latency requirement?**
- < 50ms → Redis
- < 100ms → Pinecone
- < 200ms → PostgreSQL or AI Search
- > 200ms → Any

**5. Global distribution needed?**
- Yes → Cosmos DB
- No → Others are simpler

## What I'd Choose Today

For a new Azure-based RAG project:

**If budget allows:** Azure AI Search
- Integrated, managed, good enough performance

**If budget is tight:** PostgreSQL + pgvector
- Reliable, cheap, you control everything

**If performance is critical:** Pinecone
- Fastest, simplest for vector-only workloads

I wouldn't choose Cosmos DB for vector search unless I already had a strong Cosmos DB presence.

I wouldn't choose Redis unless the dataset is small or I need sub-50ms latency.

## The Bottom Line

There's no universally "best" vector database. There's the best one for your situation.

Most projects overthink this. Pick something that:
1. Integrates with your stack
2. Fits your budget
3. Meets your performance needs
4. Your team can support

Then move on to more important problems, like actually building value for users.

The vector database is infrastructure. It should be boring and reliable. Don't let perfect be the enemy of good enough.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
