---
title: "Sentiment Analysis in Power Platform: Understanding Customer Emotions"
description: "AI Builder's sentiment analysis capability classifies text into positive, negative, neutral, or mixed sentiment categories—the prebuilt model runs over…"
author: Michael John Peña
draft: false
date: 2022-04-14
tags:
  - Power Platform
  - AI Builder
  - Sentiment Analysis
  - NLP
  - Customer Experience
---

AI Builder's sentiment analysis capability classifies text into positive, negative, neutral, or mixed sentiment categories—the prebuilt model runs over customer feedback, survey responses, support ticket comments, or social media mentions to give automated sentiment scores at scale. The practical use in Power Automate: a survey response is submitted via Microsoft Forms; the Power Automate flow runs the response text through AI Builder sentiment analysis; the flow routes the response to the customer feedback Dataverse table with the sentiment score; a weekly Power BI report aggregates sentiment trends by product, region, or time period. The accuracy consideration: sentiment analysis models perform best on straightforward, direct expression of opinion; they struggle with sarcasm, nuanced feedback ("I would have given 5 stars but the shipping was slow—otherwise perfect!"), and domain-specific language where standard positive/negative associations don't apply. For high-stakes use cases (deciding to escalate a customer complaint), sentiment scores should inform rather than fully automate the routing decision.

## Understanding Sentiment Analysis

```yaml
output:
  sentiment:
    - Positive
    - Negative
    - Neutral
    - Mixed

confidence_score:
  range: 0 to 1
  meaning: Model's confidence in classification

use_cases:
  - Customer feedback analysis
  - Social media monitoring
  - Support ticket prioritization
  - Product review analysis
  - Employee feedback processing
```

## Basic Implementation

### In Power Apps

```powerfx
// Analyze feedback text
AnalyzeFeedbackBtn.OnSelect =
    Set(
        SentimentResult,
        AIBuilder.AnalyzeSentiment(FeedbackTextInput.Text)
    );

// Display result
SentimentLabel.Text = SentimentResult.sentiment
ConfidenceLabel.Text = "Confidence: " & Text(SentimentResult.confidenceScore * 100, "0") & "%"

// Visual indicator
SentimentIcon.Icon = Switch(
    SentimentResult.sentiment,
    "positive", Icon.Emoji2,  // Happy
    "negative", Icon.Emoji,   // Sad
    Icon.EmojiNeutral         // Neutral
)

SentimentIcon.Color = Switch(
    SentimentResult.sentiment,
    "positive", Color.Green,
    "negative", Color.Red,
    Color.Gray
)
```

### In Power Automate

```json
{
    "trigger": {
        "type": "When_item_created",
        "inputs": {
            "table": "customer_feedback"
        }
    },
    "actions": {
        "Analyze_Sentiment": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-sentimentAnalysis",
                "text": "@{triggerBody()?['feedback_text']}"
            }
        },
        "Update_Record": {
            "type": "UpdateRecord",
            "inputs": {
                "table": "customer_feedback",
                "id": "@{triggerBody()?['id']}",
                "item": {
                    "sentiment": "@{body('Analyze_Sentiment')?['sentiment']}",
                    "sentiment_score": "@{body('Analyze_Sentiment')?['confidenceScore']}"
                }
            }
        },
        "Route_Negative_Feedback": {
            "type": "Condition",
            "expression": {
                "equals": ["@body('Analyze_Sentiment')?['sentiment']", "negative"]
            },
            "actions": {
                "Create_Urgent_Case": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "cases",
                        "item": {
                            "title": "Urgent: Negative Customer Feedback",
                            "description": "@{triggerBody()?['feedback_text']}",
                            "priority": "High",
                            "customer_id": "@{triggerBody()?['customer_id']}"
                        }
                    }
                },
                "Notify_Team": {
                    "type": "SendEmail",
                    "inputs": {
                        "to": "customer-success@company.com",
                        "subject": "Negative Feedback Alert",
                        "body": "Customer @{triggerBody()?['customer_name']} submitted negative feedback.\n\n@{triggerBody()?['feedback_text']}"
                    }
                }
            }
        }
    }
}
```

## Batch Processing Reviews

```json
{
    "definition": {
        "trigger": {
            "type": "Recurrence",
            "recurrence": {
                "frequency": "Day",
                "interval": 1
            }
        },
        "actions": {
            "Get_Unprocessed_Reviews": {
                "type": "ListRecords",
                "inputs": {
                    "table": "product_reviews",
                    "filter": "sentiment eq null"
                }
            },
            "Process_Each_Review": {
                "type": "ForEach",
                "foreach": "@body('Get_Unprocessed_Reviews')?['value']",
                "runtimeConfiguration": {
                    "concurrency": {
                        "repetitions": 10
                    }
                },
                "actions": {
                    "Analyze": {
                        "type": "AIBuilder",
                        "inputs": {
                            "model": "prebuilt-sentimentAnalysis",
                            "text": "@{items('Process_Each_Review')?['review_text']}"
                        }
                    },
                    "Update_Review": {
                        "type": "UpdateRecord",
                        "inputs": {
                            "table": "product_reviews",
                            "id": "@{items('Process_Each_Review')?['id']}",
                            "item": {
                                "sentiment": "@{body('Analyze')?['sentiment']}",
                                "sentiment_score": "@{body('Analyze')?['confidenceScore']}",
                                "processed_date": "@{utcNow()}"
                            }
                        }
                    }
                }
            },
            "Generate_Summary_Report": {
                "type": "Compose",
                "inputs": {
                    "total_processed": "@{length(body('Get_Unprocessed_Reviews')?['value'])}",
                    "report_date": "@{utcNow()}"
                }
            }
        }
    }
}
```

## Sentiment Dashboard

### Power BI Integration

```dax
// DAX measures for sentiment dashboard

// Sentiment distribution
PositiveCount = CALCULATE(COUNT(Feedback[ID]), Feedback[Sentiment] = "positive")
NegativeCount = CALCULATE(COUNT(Feedback[ID]), Feedback[Sentiment] = "negative")
NeutralCount = CALCULATE(COUNT(Feedback[ID]), Feedback[Sentiment] = "neutral")

// Sentiment score over time
AvgSentimentScore =
AVERAGEX(
    Feedback,
    SWITCH(
        Feedback[Sentiment],
        "positive", 1,
        "negative", -1,
        0
    )
)

// Net Promoter Score approximation
NPSScore =
VAR Promoters = CALCULATE(COUNT(Feedback[ID]), Feedback[Sentiment] = "positive")
VAR Detractors = CALCULATE(COUNT(Feedback[ID]), Feedback[Sentiment] = "negative")
VAR Total = COUNT(Feedback[ID])
RETURN DIVIDE(Promoters - Detractors, Total) * 100
```

### Power Apps Dashboard

```powerfx
// Load sentiment statistics
OnVisible =
    ClearCollect(
        SentimentStats,
        {
            Positive: CountIf(Feedback, Sentiment = "positive"),
            Negative: CountIf(Feedback, Sentiment = "negative"),
            Neutral: CountIf(Feedback, Sentiment = "neutral"),
            Total: CountRows(Feedback)
        }
    );

// Calculate percentages
Set(
    PositivePct,
    First(SentimentStats).Positive / First(SentimentStats).Total * 100
);

// Trend over last 7 days
ClearCollect(
    SentimentTrend,
    GroupBy(
        AddColumns(
            Filter(Feedback, CreatedDate >= Today() - 7),
            "DayNum", DateDiff(Today() - 7, CreatedDate, TimeUnit.Days)
        ),
        "DayNum",
        "DayFeedback"
    )
);
```

## Combining with Other Analysis

```powerfx
// Comprehensive text analysis
FullAnalysisBtn.OnSelect =
    // Sentiment
    Set(
        Sentiment,
        AIBuilder.AnalyzeSentiment(InputText.Text)
    );

    // Key phrases
    Set(
        KeyPhrases,
        AIBuilder.ExtractKeyPhrases(InputText.Text)
    );

    // Entity extraction
    Set(
        Entities,
        AIBuilder.ExtractEntities(InputText.Text)
    );

    // Language detection
    Set(
        Language,
        AIBuilder.DetectLanguage(InputText.Text)
    );

    Navigate(AnalysisResultsScreen);

// Display comprehensive results
SentimentResult.Text = Sentiment.sentiment
KeyPhrasesGallery.Items = KeyPhrases.phrases
EntitiesGallery.Items = Entities.entities
LanguageResult.Text = Language.language
```

## Best Practices

```yaml
accuracy_considerations:
  text_length:
    - Very short text may be less accurate
    - Combine related texts if needed

  context:
    - Sarcasm may be misclassified
    - Industry-specific language may need custom models

  mixed_sentiment:
    - Long texts may have mixed sentiment
    - Consider sentence-level analysis for detailed feedback

implementation_tips:
  - Set confidence thresholds for automation
  - Human review for edge cases
  - Track accuracy over time
  - Collect feedback for improvement
```

## Conclusion

Sentiment analysis enables automated understanding of customer emotions:
- Prioritize negative feedback for immediate response
- Track sentiment trends over time
- Identify product/service issues early
- Measure customer satisfaction at scale

When combined with other AI Builder capabilities, it forms a powerful customer intelligence toolkit.

## Resources

- [Sentiment Analysis Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-sentiment-analysis)
- [Text Analytics Best Practices](https://docs.microsoft.com/en-us/azure/cognitive-services/text-analytics/overview)
