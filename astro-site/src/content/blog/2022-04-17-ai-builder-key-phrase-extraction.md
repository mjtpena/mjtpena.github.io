---
title: "Key Phrase Extraction with AI Builder: Identifying Important Concepts"
author: Michael John Peña
draft: false
date: 2022-04-17
tags:
  - Power Platform
  - AI Builder
  - Key Phrases
  - NLP
  - Text Analysis

---

I wrote "Key Phrase Extraction with AI Builder: Identifying Important Concepts" to share practical, production-minded guidance on this topic.

## How It Works

```yaml
input: Long-form text content
output:
  - List of key phrases
  - Ranked by importance
  - No confidence scores (deterministic)

use_cases:
  - Document tagging
  - Content summarization
  - Topic identification
  - Search optimization
  - Trend analysis
```

## Basic Implementation

```powerfx
// Extract key phrases
ExtractPhrasesBtn.OnSelect =
    Set(
        KeyPhraseResult,
        AIBuilder.ExtractKeyPhrases(ArticleText.Text)
    );

// Display as tags
KeyPhrasesGallery.Items = KeyPhraseResult.phrases

// Auto-tag content
AutoTagBtn.OnSelect =
    ForAll(
        FirstN(KeyPhraseResult.phrases, 5),  // Top 5 phrases
        Patch(
            ContentTags,
            Defaults(ContentTags),
            {
                ContentId: CurrentArticle.ID,
                Tag: ThisRecord.Value,
                Source: "AI Builder"
            }
        )
    )
```

## Document Summarization

```json
{
    "actions": {
        "Extract_Key_Phrases": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-keyPhraseExtraction",
                "text": "@{body('Get_Document_Content')}"
            }
        },
        "Generate_Summary": {
            "type": "Compose",
            "inputs": {
                "title": "@{triggerBody()?['title']}",
                "keyTopics": "@{take(body('Extract_Key_Phrases')?['phrases'], 10)}",
                "summary": "This document covers: @{join(take(body('Extract_Key_Phrases')?['phrases'], 5), ', ')}"
            }
        },
        "Update_Document_Metadata": {
            "type": "UpdateRecord",
            "inputs": {
                "table": "documents",
                "item": {
                    "tags": "@{join(take(body('Extract_Key_Phrases')?['phrases'], 5), ',')}",
                    "auto_summary": "@{outputs('Generate_Summary')?['summary']}"
                }
            }
        }
    }
}
```

## Content Recommendation

```powerfx
// Find similar content based on key phrases
FindSimilarContent.OnSelect =
    // Get key phrases from current content
    Set(
        CurrentPhrases,
        AIBuilder.ExtractKeyPhrases(CurrentContent.Body)
    );

    // Find content with matching tags
    ClearCollect(
        SimilarContent,
        Filter(
            AllContent,
            ID <> CurrentContent.ID,
            CountIf(
                CurrentPhrases.phrases,
                Value in Tags
            ) >= 2  // At least 2 matching phrases
        )
    )
```

## Trend Analysis

```json
{
    "definition": {
        "trigger": {
            "type": "Recurrence",
            "frequency": "Day"
        },
        "actions": {
            "Get_Recent_Feedback": {
                "type": "ListRecords",
                "inputs": {
                    "table": "customer_feedback",
                    "filter": "createdon ge @{addDays(utcNow(), -7)}"
                }
            },
            "Extract_All_Phrases": {
                "type": "ForEach",
                "foreach": "@body('Get_Recent_Feedback')?['value']",
                "actions": {
                    "Extract_Phrases": {
                        "type": "AIBuilder",
                        "inputs": {
                            "model": "prebuilt-keyPhraseExtraction",
                            "text": "@{items('Extract_All_Phrases')?['feedback_text']}"
                        }
                    },
                    "Store_Phrases": {
                        "type": "AppendToArrayVariable",
                        "inputs": {
                            "name": "allPhrases",
                            "value": "@body('Extract_Phrases')?['phrases']"
                        }
                    }
                }
            },
            "Aggregate_Phrase_Counts": {
                "type": "Compose"
            },
            "Generate_Trend_Report": {
                "type": "SendEmail",
                "inputs": {
                    "subject": "Weekly Feedback Trends",
                    "body": "Top discussed topics this week..."
                }
            }
        }
    }
}
```

## Best Practices

```yaml
text_preparation:
  - Remove boilerplate content
  - Ensure sufficient text length
  - Clean formatting issues

result_handling:
  - Filter irrelevant phrases
  - Normalize case
  - Remove duplicates
  - Limit to meaningful count

applications:
  - Combine with other NLP for richer analysis
  - Use for search enhancement
  - Power recommendation systems
```

## Conclusion

Key phrase extraction enables:
- Automatic document tagging
- Quick content summarization
- Topic trend identification
- Enhanced search and discovery

It's a simple but powerful tool for understanding content at scale.

## Resources

- [Key Phrase Extraction Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-key-phrase-extraction)

