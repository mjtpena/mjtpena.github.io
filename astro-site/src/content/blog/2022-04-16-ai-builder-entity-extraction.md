---
title: "Entity Extraction with AI Builder: Mining Structured Data from Text"
author: Michael John Peña
draft: false
date: 2022-04-16
tags:
  - Power Platform
  - AI Builder
  - Entity Extraction
  - NLP
  - Data Extraction

---

I wrote "Entity Extraction with AI Builder: Mining Structured Data from Text" to share practical, production-minded guidance on this topic.

## Pre-built Entity Types

```yaml
supported_entities:
  - Person: Names of people
  - Organization: Company names, institutions
  - Location: Places, addresses
  - DateTime: Dates, times, durations
  - Quantity: Numbers, measurements
  - PhoneNumber: Phone numbers
  - Email: Email addresses
  - URL: Web addresses
```

## Basic Usage

```powerfx
// Extract entities from text
ExtractBtn.OnSelect =
    Set(
        EntityResult,
        AIBuilder.ExtractEntities(InputText.Text)
    );

// Display by entity type
ClearCollect(
    PersonEntities,
    Filter(EntityResult.entities, type = "Person")
);

ClearCollect(
    OrgEntities,
    Filter(EntityResult.entities, type = "Organization")
);

ClearCollect(
    LocationEntities,
    Filter(EntityResult.entities, type = "Location")
);

// Create contact from extracted entities
CreateContactBtn.OnSelect =
    Patch(
        Contacts,
        Defaults(Contacts),
        {
            FullName: First(PersonEntities).text,
            Company: First(OrgEntities).text,
            Email: First(Filter(EntityResult.entities, type = "Email")).text,
            Phone: First(Filter(EntityResult.entities, type = "PhoneNumber")).text
        }
    )
```

## Email Processing

```json
{
    "actions": {
        "Extract_From_Email": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-entityExtraction",
                "text": "@{triggerBody()?['body']}"
            }
        },
        "Process_Contacts": {
            "type": "ForEach",
            "foreach": "@body('Extract_From_Email')?['entities']",
            "actions": {
                "Check_Entity_Type": {
                    "type": "Switch",
                    "expression": "@items('Process_Contacts')?['type']",
                    "cases": {
                        "Person": {
                            "actions": {
                                "Create_Contact_If_New": {
                                    "type": "Condition",
                                    "expression": {
                                        "equals": [
                                            "@length(body('Check_Existing_Contact')?['value'])",
                                            0
                                        ]
                                    }
                                }
                            }
                        },
                        "Organization": {
                            "actions": {
                                "Link_To_Account": {}
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Custom Entity Extraction

Train models to extract domain-specific entities:

```yaml
custom_entities_example:
  insurance_domain:
    - PolicyNumber
    - ClaimAmount
    - IncidentDate
    - VehicleMake
    - VehicleModel

  healthcare_domain:
    - PatientID
    - Diagnosis
    - Medication
    - Dosage
    - Provider
```

## Practical Applications

### Meeting Notes Parser

```powerfx
// Parse meeting notes for action items
ParseMeetingNotes.OnSelect =
    Set(
        MeetingEntities,
        AIBuilder.ExtractEntities(MeetingNotesText.Text)
    );

    // Extract attendees (Person entities)
    ClearCollect(
        Attendees,
        Filter(MeetingEntities.entities, type = "Person")
    );

    // Extract mentioned dates for follow-ups
    ClearCollect(
        MentionedDates,
        Filter(MeetingEntities.entities, type = "DateTime")
    );

    // Extract mentioned companies
    ClearCollect(
        Companies,
        Filter(MeetingEntities.entities, type = "Organization")
    );

// Create meeting record
SaveMeetingBtn.OnSelect =
    Patch(
        Meetings,
        Defaults(Meetings),
        {
            Date: Today(),
            Notes: MeetingNotesText.Text,
            Attendees: Concat(Attendees, text, ", "),
            FollowUpDate: If(
                CountRows(MentionedDates) > 0,
                DateValue(Last(MentionedDates).text),
                DateAdd(Today(), 7, TimeUnit.Days)
            )
        }
    )
```

### Contract Analysis

```json
{
    "actions": {
        "Extract_Contract_Entities": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-entityExtraction",
                "text": "@{body('Extract_Text_From_PDF')}"
            }
        },
        "Identify_Parties": {
            "type": "Filter",
            "inputs": {
                "from": "@body('Extract_Contract_Entities')?['entities']",
                "where": "@equals(item()?['type'], 'Organization')"
            }
        },
        "Extract_Dates": {
            "type": "Filter",
            "inputs": {
                "from": "@body('Extract_Contract_Entities')?['entities']",
                "where": "@equals(item()?['type'], 'DateTime')"
            }
        },
        "Create_Contract_Record": {
            "type": "CreateRecord",
            "inputs": {
                "table": "contracts",
                "item": {
                    "party_a": "@{first(body('Identify_Parties'))?['text']}",
                    "party_b": "@{last(body('Identify_Parties'))?['text']}",
                    "effective_date": "@{first(body('Extract_Dates'))?['text']}",
                    "expiration_date": "@{last(body('Extract_Dates'))?['text']}"
                }
            }
        }
    }
}
```

## Combining with Key Phrase Extraction

```powerfx
// Comprehensive text analysis
AnalyzeDocument.OnSelect =
    // Extract entities
    Set(
        Entities,
        AIBuilder.ExtractEntities(DocumentText.Text)
    );

    // Extract key phrases
    Set(
        KeyPhrases,
        AIBuilder.ExtractKeyPhrases(DocumentText.Text)
    );

    // Combine for document summary
    ClearCollect(
        DocumentSummary,
        {
            People: Concat(Filter(Entities.entities, type = "Person"), text, ", "),
            Organizations: Concat(Filter(Entities.entities, type = "Organization"), text, ", "),
            Topics: Concat(KeyPhrases.phrases, Value, ", "),
            Dates: Concat(Filter(Entities.entities, type = "DateTime"), text, ", ")
        }
    )
```

## Best Practices

```yaml
accuracy_tips:
  text_quality:
    - Clear, well-formatted text
    - Proper punctuation
    - Consistent formatting

  entity_handling:
    - Validate extracted entities
    - Handle duplicates
    - Normalize formats (dates, phones)

  edge_cases:
    - Abbreviations
    - Nicknames
    - Informal references
```

## Conclusion

Entity extraction turns unstructured text into structured data:
- Automatically identify people, organizations, locations
- Extract dates, quantities, and contact information
- Enable intelligent document processing
- Power automated workflows

Combined with other AI Builder capabilities, it enables comprehensive text understanding.

## Resources

- [Entity Extraction Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-entity-extraction)
- [Custom Entity Extraction](https://docs.microsoft.com/en-us/ai-builder/entity-extraction-model)

