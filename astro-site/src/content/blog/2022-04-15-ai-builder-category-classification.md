---
title: "Category Classification with AI Builder: Automating Text Categorization"
author: Michael John Peña
draft: false
date: 2022-04-15
tags:
  - Power Platform
  - AI Builder
  - Classification
  - NLP
  - Automation

---

I wrote "Category Classification with AI Builder: Automating Text Categorization" to share practical, production-minded guidance on this topic.

## Use Cases

```yaml
customer_support:
  - Ticket categorization
  - Routing to departments
  - Priority assignment
  - Issue type identification

content_management:
  - Document classification
  - Email categorization
  - Content tagging
  - Compliance flagging

sales:
  - Lead qualification
  - Opportunity categorization
  - Competitor mention detection
```

## Training a Custom Classifier

### Preparing Training Data

```yaml
requirements:
  minimum_per_category: 10 examples
  recommended: 50+ per category
  balanced: Similar count across categories

data_format:
  columns:
    - text: The content to classify
    - category: The assigned label

example_data:
  - text: "Cannot login to my account, password reset not working"
    category: "Account Access"
  - text: "When will my order arrive? Tracking shows no movement"
    category: "Shipping"
  - text: "I want to return this product, it's not what I expected"
    category: "Returns"
```

### Creating the Model

```yaml
steps:
  1_create_model:
    - Navigate to AI Builder > Custom models
    - Select "Category classification"
    - Name your model

  2_upload_data:
    - Import from Dataverse table
    - Or upload CSV/Excel file
    - Map columns to text and category

  3_train_model:
    - Review data distribution
    - Start training
    - Wait for completion (15-60 minutes)

  4_evaluate:
    - Review accuracy metrics
    - Test with sample text
    - Publish when satisfied
```

## Using the Classifier

### In Power Apps

```powerfx
// Classify incoming text
ClassifyBtn.OnSelect =
    Set(
        ClassificationResult,
        AIBuilder.Classify(
            "SupportTicketClassifier",
            TicketDescription.Text
        )
    );

// Display top prediction
PredictedCategory.Text = First(ClassificationResult.predictions).category
Confidence.Text = Text(First(ClassificationResult.predictions).confidence * 100, "0") & "%"

// Show all predictions
ClearCollect(
    AllPredictions,
    SortByColumns(
        ClassificationResult.predictions,
        "confidence",
        SortOrder.Descending
    )
)

// Auto-assign if confident
If(
    First(ClassificationResult.predictions).confidence > 0.85,
    Set(AutoAssigned, true);
    Set(SelectedCategory, First(ClassificationResult.predictions).category),
    Set(AutoAssigned, false);
    Set(SelectedCategory, "")
)
```

### In Power Automate

```json
{
    "trigger": {
        "type": "When_email_arrives",
        "inputs": {
            "folder": "Inbox"
        }
    },
    "actions": {
        "Classify_Email": {
            "type": "AIBuilder",
            "inputs": {
                "model": "EmailClassifier",
                "text": "@{triggerBody()?['body']}"
            }
        },
        "Route_Based_On_Category": {
            "type": "Switch",
            "expression": "@first(body('Classify_Email')?['predictions'])?['category']",
            "cases": {
                "Sales_Inquiry": {
                    "actions": {
                        "Forward_To_Sales": {
                            "type": "SendEmail",
                            "inputs": {
                                "to": "sales@company.com"
                            }
                        }
                    }
                },
                "Support_Request": {
                    "actions": {
                        "Create_Support_Ticket": {
                            "type": "CreateRecord",
                            "inputs": {
                                "table": "support_tickets"
                            }
                        }
                    }
                },
                "Billing_Question": {
                    "actions": {
                        "Forward_To_Billing": {
                            "type": "SendEmail",
                            "inputs": {
                                "to": "billing@company.com"
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Multi-Label Classification

For content that belongs to multiple categories:

```powerfx
// Get all predictions above threshold
ClearCollect(
    ApplicableCategories,
    Filter(
        ClassificationResult.predictions,
        confidence > 0.5
    )
)

// Apply multiple tags
ForAll(
    ApplicableCategories,
    Patch(
        ContentTags,
        Defaults(ContentTags),
        {
            ContentId: CurrentContent.ID,
            Tag: ThisRecord.category,
            Confidence: ThisRecord.confidence
        }
    )
)
```

## Support Ticket Routing

Complete implementation:

```json
{
    "definition": {
        "trigger": {
            "type": "When_a_row_is_added",
            "inputs": {
                "table": "support_tickets"
            }
        },
        "actions": {
            "Classify_Ticket": {
                "type": "AIBuilder",
                "inputs": {
                    "model": "SupportTicketClassifier",
                    "text": "@{triggerBody()?['description']}"
                }
            },
            "Get_Top_Prediction": {
                "type": "Compose",
                "inputs": {
                    "category": "@{first(body('Classify_Ticket')?['predictions'])?['category']}",
                    "confidence": "@{first(body('Classify_Ticket')?['predictions'])?['confidence']}"
                }
            },
            "Get_Assignment_Rules": {
                "type": "ListRecords",
                "inputs": {
                    "table": "assignment_rules",
                    "filter": "category eq '@{outputs('Get_Top_Prediction')?['category']}'"
                }
            },
            "Update_Ticket": {
                "type": "UpdateRecord",
                "inputs": {
                    "table": "support_tickets",
                    "id": "@{triggerBody()?['ticketid']}",
                    "item": {
                        "category": "@{outputs('Get_Top_Prediction')?['category']}",
                        "assigned_team": "@{first(body('Get_Assignment_Rules')?['value'])?['team']}",
                        "priority": "@{first(body('Get_Assignment_Rules')?['value'])?['default_priority']}",
                        "classification_confidence": "@{outputs('Get_Top_Prediction')?['confidence']}"
                    }
                }
            },
            "Notify_Team": {
                "type": "Condition",
                "expression": {
                    "equals": ["@first(body('Get_Assignment_Rules')?['value'])?['notify_on_assignment']", true]
                },
                "actions": {
                    "Send_Team_Notification": {
                        "type": "SendNotification"
                    }
                }
            }
        }
    }
}
```

## Model Improvement

```yaml
continuous_improvement:
  collect_corrections:
    - Track when users change classifications
    - Store original prediction and correction

  periodic_retraining:
    - Add corrected examples to training data
    - Retrain monthly or when accuracy drops

  monitoring:
    - Track classification accuracy
    - Alert on confidence score degradation
    - Identify new categories emerging
```

## Conclusion

Category classification automates text organization:
- Route content to appropriate teams
- Ensure consistent categorization
- Scale classification without manual effort
- Improve over time with feedback

It's foundational for intelligent document and communication management.

## Resources

- [Category Classification Documentation](https://docs.microsoft.com/en-us/ai-builder/text-classification-overview)
- [Training Best Practices](https://docs.microsoft.com/en-us/ai-builder/before-you-build-text-classification-model)

