---
title: "Text Recognition with AI Builder: OCR for the Power Platform"
author: Michael John Peña
draft: false
date: 2022-04-13
tags:
  - Power Platform
  - AI Builder
  - OCR
  - Text Recognition
  - Automation

---

I wrote "Text Recognition with AI Builder: OCR for the Power Platform" to share practical, production-minded guidance on this topic.

## Text Recognition Capabilities

```yaml
supported_content:
  - Printed text (multiple fonts)
  - Handwritten text (with reduced accuracy)
  - Multiple languages
  - Mixed layouts

output:
  - Extracted text
  - Word-level bounding boxes
  - Line groupings
  - Confidence scores
```

## Basic Usage

### In Power Apps

```powerfx
// Extract text from image
ExtractTextBtn.OnSelect =
    Set(
        OCRResult,
        AIBuilder.TextRecognition(CapturedImage)
    );

// Display all extracted text
ExtractedTextLabel.Text = Concat(
    OCRResult.results,
    text,
    Char(10)  // New line between results
)

// Access individual text blocks
ForAll(
    OCRResult.results,
    {
        Text: ThisRecord.text,
        Confidence: ThisRecord.confidence,
        BoundingBox: {
            Left: ThisRecord.boundingBox.left,
            Top: ThisRecord.boundingBox.top,
            Width: ThisRecord.boundingBox.width,
            Height: ThisRecord.boundingBox.height
        }
    }
)
```

### In Power Automate

```json
{
    "actions": {
        "Extract_Text": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-textRecognition",
                "image": "@{triggerBody()?['image']}"
            }
        },
        "Combine_Text": {
            "type": "Compose",
            "inputs": "@{join(body('Extract_Text')?['results'], ' ')}"
        },
        "Search_For_Keywords": {
            "type": "Condition",
            "expression": {
                "or": [
                    {"contains": ["@outputs('Combine_Text')", "URGENT"]},
                    {"contains": ["@outputs('Combine_Text')", "PRIORITY"]}
                ]
            },
            "actions": {
                "Flag_Document": {
                    "type": "CreateRecord",
                    "inputs": {
                        "table": "flagged_documents",
                        "item": {
                            "content": "@{outputs('Combine_Text')}",
                            "reason": "Contains priority keywords"
                        }
                    }
                }
            }
        }
    }
}
```

## Practical Applications

### License Plate Reader

```powerfx
// Capture and read license plate
ReadPlateBtn.OnSelect =
    Set(PlateImage, Camera1.Photo);
    Set(
        PlateOCR,
        AIBuilder.TextRecognition(PlateImage)
    );

    // Extract plate number (typically largest/most prominent text)
    Set(
        PlateNumber,
        First(
            Sort(
                PlateOCR.results,
                boundingBox.width * boundingBox.height,
                SortOrder.Descending
            )
        ).text
    );

    // Clean up plate number (remove spaces, standardize)
    Set(
        CleanPlateNumber,
        Upper(Substitute(PlateNumber, " ", ""))
    );

// Lookup vehicle
If(
    !IsBlank(CleanPlateNumber),
    Set(
        VehicleInfo,
        LookUp(Vehicles, LicensePlate = CleanPlateNumber)
    )
)
```

### Whiteboard Capture

```powerfx
// Capture whiteboard and extract notes
CaptureWhiteboardBtn.OnSelect =
    Set(WhiteboardImage, Camera1.Photo);
    Set(
        WhiteboardText,
        AIBuilder.TextRecognition(WhiteboardImage)
    );

    // Organize text by position (top to bottom, left to right)
    ClearCollect(
        OrganizedText,
        SortByColumns(
            ForAll(
                WhiteboardText.results,
                {
                    Text: ThisRecord.text,
                    Top: ThisRecord.boundingBox.top,
                    Left: ThisRecord.boundingBox.left
                }
            ),
            "Top", SortOrder.Ascending,
            "Left", SortOrder.Ascending
        )
    );

// Create meeting notes
SaveNotesBtn.OnSelect =
    Patch(
        MeetingNotes,
        Defaults(MeetingNotes),
        {
            MeetingDate: Today(),
            Notes: Concat(OrganizedText, Text, Char(10)),
            WhiteboardImage: WhiteboardImage,
            CreatedBy: User().Email
        }
    )
```

### Document Classification

```json
{
    "actions": {
        "Extract_Document_Text": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-textRecognition",
                "image": "@{triggerBody()}"
            }
        },
        "Classify_Document": {
            "type": "Switch",
            "expression": "@true",
            "cases": {
                "Invoice": {
                    "case": "@contains(body('Extract_Document_Text')?['text'], 'INVOICE')",
                    "actions": {
                        "Route_To_AP": {
                            "type": "CreateRecord",
                            "inputs": {
                                "table": "ap_inbox"
                            }
                        }
                    }
                },
                "PurchaseOrder": {
                    "case": "@or(contains(body('Extract_Document_Text')?['text'], 'PURCHASE ORDER'), contains(body('Extract_Document_Text')?['text'], 'P.O.'))",
                    "actions": {
                        "Route_To_Procurement": {
                            "type": "CreateRecord",
                            "inputs": {
                                "table": "procurement_inbox"
                            }
                        }
                    }
                },
                "Contract": {
                    "case": "@or(contains(body('Extract_Document_Text')?['text'], 'AGREEMENT'), contains(body('Extract_Document_Text')?['text'], 'CONTRACT'))",
                    "actions": {
                        "Route_To_Legal": {
                            "type": "CreateRecord",
                            "inputs": {
                                "table": "legal_inbox"
                            }
                        }
                    }
                }
            },
            "default": {
                "actions": {
                    "Route_To_General": {
                        "type": "CreateRecord"
                    }
                }
            }
        }
    }
}
```

## Handling Different Languages

```powerfx
// Text recognition supports multiple languages automatically
// No configuration needed - it detects language

ExtractMultilingualText.OnSelect =
    Set(
        OCRResult,
        AIBuilder.TextRecognition(DocumentImage)
    );

    // Use Language Detection to identify language
    Set(
        DetectedLanguage,
        AIBuilder.LanguageDetection(
            Concat(OCRResult.results, text, " ")
        ).language
    );

    // Route based on language
    Switch(
        DetectedLanguage,
        "en", Navigate(EnglishProcessing),
        "es", Navigate(SpanishProcessing),
        "fr", Navigate(FrenchProcessing),
        Navigate(DefaultProcessing)
    )
```

## Best Practices

```yaml
image_quality:
  resolution:
    - Minimum 150 DPI
    - Higher for small text
  lighting:
    - Even illumination
    - Avoid shadows
  orientation:
    - Straight alignment
    - Minimal skew

accuracy_improvement:
  - Use high contrast images
  - Ensure text is in focus
  - Avoid curved surfaces
  - Pre-process if needed (crop, rotate)

post_processing:
  - Validate extracted text
  - Handle OCR errors (common substitutions)
  - Use spell check for known vocabularies
  - Implement confidence thresholds
```

## Conclusion

Text recognition unlocks information trapped in images:
- Digitize physical documents
- Automate data extraction
- Enable document search
- Support accessibility

Combined with other AI Builder capabilities, it forms the foundation for intelligent document processing.

## Resources

- [Text Recognition Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-text-recognition)
- [OCR Best Practices](https://docs.microsoft.com/en-us/azure/cognitive-services/computer-vision/concept-recognizing-text)

