---
title: "Holiday Tech Reading List: Books for Azure and AI Enthusiasts"
description: "The holidays are the reading catch-up opportunity I look forward to all year—the stack of technical books that accumulated while the project workload was…"
author: Michael John Peña
draft: false
date: 2022-12-24
tags:
  - books
  - Learning
  - Career
  - Recommendations
  - Holidays
---

The holidays are the reading catch-up opportunity I look forward to all year—the stack of technical books that accumulated while the project workload was too high to give them proper attention. For Azure developers and data engineers heading into 2023, the reading list I actually worked through this December: *Designing Data-Intensive Applications* by Martin Kleppmann remains the most important book on distributed systems and data architecture I know—it explains the failure modes and trade-offs that underlie every Azure data service design decision; *Building Machine Learning Pipelines* by Hannes Hapke and Catherine Nelson fills in the MLOps end-to-end operational picture that Azure ML documentation assumes you already understand; *Team Topologies* by Skelton and Pais is the organisational design book that gives language to the platform engineering patterns that dominated 2022; and for the AI narrative context that December 2022 demanded, the *AI Superpowers* book by Kai-Fu Lee provides a grounding in how AI capability translates to real-world deployment across different organisational and regulatory contexts. The one I'd add for 2023 specifically: anything on prompt engineering and LLM application patterns—the field was moving too fast for books in December 2022, but the blog posts and papers from Anthropic, OpenAI's research team, and the LangChain community were the practical curriculum.

## Cloud Architecture

### "Designing Data-Intensive Applications" by Martin Kleppmann
The definitive guide to building reliable, scalable systems. Essential reading for anyone working with distributed data.

**Key Topics:**
- Data models and query languages
- Storage and retrieval
- Replication and partitioning
- Consistency and consensus

**Why Read It:** Every concept applies directly to Azure architecture decisions.

### "Building Microservices" by Sam Newman
Practical guide to microservices architecture with real-world patterns.

**Key Topics:**
- Service decomposition
- Integration patterns
- Deployment strategies
- Monitoring and security

**Azure Relevance:** Maps directly to Azure Container Apps, AKS, and Service Bus patterns.

## AI and Machine Learning

### "Hands-On Machine Learning" by Aurelien Geron
The practical ML book - perfect for engineers getting into AI.

**Key Topics:**
- Scikit-learn fundamentals
- Neural networks with TensorFlow
- Deep learning architectures
- Production ML pipelines

**Azure Relevance:** Concepts transfer directly to Azure ML and Cognitive Services.

### "Designing Machine Learning Systems" by Chip Huyen
Bridge the gap between ML research and production.

**Key Topics:**
- Data engineering for ML
- Feature engineering
- Model deployment
- Monitoring and maintenance

**Why Now:** As AI becomes central to development (hello, ChatGPT!), understanding ML systems is essential.

## DevOps and Platform Engineering

### "The Phoenix Project" by Gene Kim
The novel that started the DevOps revolution. A fun read that teaches profound lessons.

**For Those Who've Read It:** The sequel "The Unicorn Project" focuses on the developer experience.

### "Team Topologies" by Matthew Skelton and Manuel Pais
The book behind platform engineering thinking.

**Key Topics:**
- Team interaction modes
- Conway's Law in practice
- Platform teams
- Cognitive load

**Why It Matters:** Essential reading for anyone building or using internal platforms.

### "Accelerate" by Nicole Forsgren, Jez Humble, Gene Kim
The research behind DevOps performance.

**Key Topics:**
- DORA metrics
- What high performers do differently
- Technical and cultural practices

**Why Read It:** Data-driven guide to improving engineering effectiveness.

## Software Craft

### "A Philosophy of Software Design" by John Ousterhout
Deep thinking about software complexity.

**Key Topics:**
- Complexity causes and symptoms
- Module design
- Comments and documentation
- Consistency in design

**Short but Impactful:** Can read in a weekend but will change how you think.

### "Software Engineering at Google" by Titus Winters et al.
Lessons from Google's engineering practices.

**Key Topics:**
- Code review
- Testing
- Documentation
- Large-scale changes

**Why It's Different:** Real practices from a company operating at massive scale.

## Data Engineering

### "Fundamentals of Data Engineering" by Joe Reis and Matt Housley
The comprehensive guide to modern data engineering.

**Key Topics:**
- Data generation and storage
- Ingestion and transformation
- Serving and analytics
- Security and governance

**Azure Relevance:** Covers patterns implemented by Synapse, Data Factory, and Fabric.

### "The Data Warehouse Toolkit" by Ralph Kimball
The classic dimensional modeling book - still relevant.

**Why Still Read It:** Dimensional modeling fundamentals apply regardless of technology.

## Business and Career

### "Staff Engineer" by Will Larson
Guide to the technical leadership track.

**Key Topics:**
- What staff engineers do
- Operating at staff level
- Getting to staff level

**Why Read It:** Career growth beyond senior engineer.

### "The Manager's Path" by Camille Fournier
If you're considering management or want to understand your manager.

**Key Topics:**
- Tech lead to CTO progression
- Managing teams and managers
- Building culture

**Bonus:** Written by someone who deeply understands engineering.

## Reading Strategies

```python
reading_approach = {
    "deep_read": {
        "books": [
            "Designing Data-Intensive Applications",
            "A Philosophy of Software Design"
        ],
        "approach": "Read slowly, take notes, implement concepts",
        "time": "1-2 months each"
    },
    "practical_read": {
        "books": [
            "Hands-On Machine Learning",
            "Building Microservices"
        ],
        "approach": "Read with laptop, do exercises",
        "time": "2-3 weeks"
    },
    "reference_read": {
        "books": [
            "Software Engineering at Google",
            "The Data Warehouse Toolkit"
        ],
        "approach": "Read relevant chapters, return as needed",
        "time": "Ongoing"
    },
    "weekend_read": {
        "books": [
            "The Phoenix Project",
            "Staff Engineer"
        ],
        "approach": "Read for enjoyment and insight",
        "time": "2-3 days"
    }
}
```

## My 2023 Reading Plan

1. **Q1:** "Designing Machine Learning Systems" - ChatGPT makes this timely
2. **Q2:** Deep re-read of "Designing Data-Intensive Applications"
3. **Q3:** "Staff Engineer" and related career books
4. **Q4:** Whatever emerges as important mid-year

## Free Resources

If buying books isn't in the budget:

- **Microsoft Learn** - Comprehensive Azure documentation
- **Azure Architecture Center** - Real-world patterns
- **O'Reilly Safari** - Often included with company subscriptions
- **Local Library** - Many have technical books

## Conclusion

The best technical books aren't about specific technologies - they're about principles that transfer across tools and platforms. ChatGPT can explain syntax; these books help you understand why.

Happy holidays and happy reading!

## Full Reading List

| Book | Author | Focus Area |
|------|--------|------------|
| Designing Data-Intensive Applications | Kleppmann | Architecture |
| Building Microservices | Newman | Architecture |
| Hands-On Machine Learning | Geron | ML/AI |
| Designing Machine Learning Systems | Huyen | ML/AI |
| The Phoenix Project | Kim | DevOps |
| Team Topologies | Skelton/Pais | Platform Engineering |
| Accelerate | Forsgren et al. | DevOps |
| A Philosophy of Software Design | Ousterhout | Software Craft |
| Software Engineering at Google | Winters et al. | Engineering Practice |
| Fundamentals of Data Engineering | Reis/Housley | Data |
| Staff Engineer | Larson | Career |
| The Manager's Path | Fournier | Career |
