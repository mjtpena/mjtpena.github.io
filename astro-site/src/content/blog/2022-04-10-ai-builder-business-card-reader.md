---
title: "Business Card Reader with AI Builder: Digitizing Contact Information"
author: Michael John Peña
draft: false
date: 2022-04-10
tags:
  - Power Platform
  - AI Builder
  - Business Card
  - CRM
  - Automation

---

I wrote "Business Card Reader with AI Builder: Digitizing Contact Information" to share practical, production-minded guidance on this topic.

## Extracted Fields

```yaml
business_card_fields:
  name:
    - FirstName
    - LastName
    - FullName
    - CleanedName

  contact:
    - Email
    - Phone
    - MobilePhone
    - Fax

  address:
    - Address
    - City
    - State
    - PostalCode
    - Country

  professional:
    - CompanyName
    - Department
    - JobTitle
    - Website
```

## Power Apps Implementation

```powerfx
// Camera screen for card capture
CameraControl.StreamRate = 100

CaptureButton.OnSelect =
    Set(CardImage, Camera1.Photo);
    Set(ProcessingCard, true);
    Set(
        CardData,
        AIBuilder.BusinessCardReader(CardImage)
    );
    Set(ProcessingCard, false);
    Navigate(ReviewContactScreen);

// Review screen
FirstNameInput.Default = CardData.FirstName
LastNameInput.Default = CardData.LastName
EmailInput.Default = CardData.Email
PhoneInput.Default = CardData.Phone
CompanyInput.Default = CardData.CompanyName
TitleInput.Default = CardData.JobTitle

// Confidence indicators
EmailConfidence.Fill = If(
    CardData.EmailConfidence > 0.9, Color.Green,
    CardData.EmailConfidence > 0.7, Color.Orange,
    Color.Red
)

// Save to contacts
SaveButton.OnSelect =
    // Check for duplicates
    If(
        CountRows(
            Filter(Contacts, Email = EmailInput.Text)
        ) > 0,
        Notify("Contact with this email already exists", NotificationType.Warning);
        Set(DuplicateContact, LookUp(Contacts, Email = EmailInput.Text)),

        // Create new contact
        Patch(
            Contacts,
            Defaults(Contacts),
            {
                FirstName: FirstNameInput.Text,
                LastName: LastNameInput.Text,
                Email: EmailInput.Text,
                Phone: PhoneInput.Text,
                MobilePhone: MobileInput.Text,
                Company: CompanyInput.Text,
                JobTitle: TitleInput.Text,
                Address: AddressInput.Text,
                Website: WebsiteInput.Text,
                BusinessCardImage: CardImage,
                Source: "Business Card Scan",
                ScannedDate: Now(),
                ScannedBy: User().Email
            }
        );
        Notify("Contact saved successfully!", NotificationType.Success);
        Navigate(HomeScreen)
    )
```

## Dataverse Integration

```json
{
    "actions": {
        "Process_Business_Card": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-businessCardReader",
                "document": "@{triggerBody()?['cardImage']}"
            }
        },
        "Check_Existing_Contact": {
            "type": "ListRecords",
            "inputs": {
                "table": "contacts",
                "filter": "emailaddress1 eq '@{body('Process_Business_Card')?['results']?['Email']?['value']}'"
            }
        },
        "Create_Or_Update_Contact": {
            "type": "Condition",
            "expression": {
                "equals": ["@length(body('Check_Existing_Contact')?['value'])", 0]
            },
            "actions": {
                "Create_Contact": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "contacts",
                        "item": {
                            "firstname": "@{body('Process_Business_Card')?['results']?['FirstName']?['value']}",
                            "lastname": "@{body('Process_Business_Card')?['results']?['LastName']?['value']}",
                            "emailaddress1": "@{body('Process_Business_Card')?['results']?['Email']?['value']}",
                            "telephone1": "@{body('Process_Business_Card')?['results']?['Phone']?['value']}",
                            "mobilephone": "@{body('Process_Business_Card')?['results']?['MobilePhone']?['value']}",
                            "jobtitle": "@{body('Process_Business_Card')?['results']?['JobTitle']?['value']}",
                            "address1_composite": "@{body('Process_Business_Card')?['results']?['Address']?['value']}",
                            "websiteurl": "@{body('Process_Business_Card')?['results']?['Website']?['value']}"
                        }
                    }
                },
                "Link_To_Account": {
                    "type": "Condition",
                    "expression": {
                        "not": ["@empty(body('Process_Business_Card')?['results']?['CompanyName']?['value'])"]
                    },
                    "actions": {
                        "Find_Or_Create_Account": {
                            "type": "Compose"
                        }
                    }
                }
            },
            "else": {
                "actions": {
                    "Update_Existing_Contact": {
                        "type": "UpdateRecord",
                        "inputs": {
                            "table": "contacts",
                            "id": "@{first(body('Check_Existing_Contact')?['value'])?['contactid']}",
                            "item": {
                                "telephone1": "@{coalesce(body('Process_Business_Card')?['results']?['Phone']?['value'], first(body('Check_Existing_Contact')?['value'])?['telephone1'])}",
                                "jobtitle": "@{body('Process_Business_Card')?['results']?['JobTitle']?['value']}"
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Event Lead Capture

```powerfx
// Event lead capture app
Screen: EventLeadCapture

// Event selection
EventDropdown.Items = Filter(Events, EndDate >= Today())

// Quick capture mode
QuickCaptureToggle.OnCheck =
    Set(QuickMode, true);
    Set(AutoSave, true);

// Capture and process
CaptureCardBtn.OnSelect =
    Set(CardPhoto, Camera1.Photo);
    Set(
        ExtractedData,
        AIBuilder.BusinessCardReader(CardPhoto)
    );

    If(
        QuickMode,
        // Auto-save in quick mode
        Patch(
            EventLeads,
            Defaults(EventLeads),
            {
                Event: EventDropdown.Selected,
                FirstName: ExtractedData.FirstName,
                LastName: ExtractedData.LastName,
                Email: ExtractedData.Email,
                Phone: ExtractedData.Phone,
                Company: ExtractedData.CompanyName,
                Title: ExtractedData.JobTitle,
                CardImage: CardPhoto,
                CapturedBy: User().Email,
                CapturedAt: Now(),
                Notes: "",
                FollowUpRequired: false
            }
        );
        Notify("Lead captured!", NotificationType.Success),

        // Show review form in standard mode
        Navigate(ReviewLeadScreen)
    );

// Add notes to lead
NotesInput.OnChange =
    If(
        Len(NotesInput.Text) > 0,
        UpdateContext({HasNotes: true})
    );

// Mark for follow-up
FollowUpToggle.OnCheck =
    UpdateContext({RequiresFollowUp: true});

// Batch export
ExportLeadsBtn.OnSelect =
    Set(
        LeadExport,
        Filter(EventLeads, Event.ID = EventDropdown.Selected.ID)
    );
    // Export to Excel or send to CRM
```

## Best Practices

```yaml
scanning_tips:
  card_positioning:
    - Place card on contrasting background
    - Ensure all edges visible
    - Avoid shadows
    - Keep camera parallel to card

  lighting:
    - Even, diffused lighting
    - Avoid direct flash
    - No glare on glossy cards

  card_types:
    supported:
      - Standard business cards
      - Vertical cards
      - Multi-language cards
    challenging:
      - Very dark backgrounds
      - Unusual fonts
      - Handwritten additions
```

## Conclusion

The business card reader streamlines contact digitization:
- Instant extraction of contact details
- Integration with CRM systems
- Perfect for events and networking
- Reduces manual data entry errors

## Resources

- [Business Card Reader Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-business-card)
- [CRM Integration Guide](https://docs.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-entities)

