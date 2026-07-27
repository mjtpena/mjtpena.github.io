---
title: "Language Detection with AI Builder: Routing Multilingual Content"
author: Michael John Peña
draft: false
date: 2022-04-18
tags:
  - Power Platform
  - AI Builder
  - Language Detection
  - Multilingual
  - Automation

---

I wrote "Language Detection with AI Builder: Routing Multilingual Content" to share practical, production-minded guidance on this topic.

## Capabilities

```yaml
supported_languages: 120+
output:
  - Detected language name
  - ISO language code
  - Confidence score

common_languages:
  - English (en)
  - Spanish (es)
  - French (fr)
  - German (de)
  - Portuguese (pt)
  - Chinese (zh)
  - Japanese (ja)
  - Arabic (ar)
```

## Basic Usage

```powerfx
// Detect language
DetectLanguageBtn.OnSelect =
    Set(
        LanguageResult,
        AIBuilder.DetectLanguage(InputText.Text)
    );

// Display result
LanguageLabel.Text = LanguageResult.language
LanguageCodeLabel.Text = "Code: " & LanguageResult.languageCode
ConfidenceLabel.Text = "Confidence: " & Text(LanguageResult.confidence * 100, "0") & "%"
```

## Multilingual Support Routing

```json
{
    "trigger": {
        "type": "When_email_arrives"
    },
    "actions": {
        "Detect_Language": {
            "type": "AIBuilder",
            "inputs": {
                "model": "prebuilt-languageDetection",
                "text": "@{triggerBody()?['body']}"
            }
        },
        "Route_By_Language": {
            "type": "Switch",
            "expression": "@body('Detect_Language')?['languageCode']",
            "cases": {
                "en": {
                    "actions": {
                        "Forward_To_English_Team": {
                            "type": "SendEmail",
                            "inputs": {
                                "to": "support-en@company.com"
                            }
                        }
                    }
                },
                "es": {
                    "actions": {
                        "Forward_To_Spanish_Team": {
                            "type": "SendEmail",
                            "inputs": {
                                "to": "support-es@company.com"
                            }
                        }
                    }
                },
                "fr": {
                    "actions": {
                        "Forward_To_French_Team": {
                            "type": "SendEmail",
                            "inputs": {
                                "to": "support-fr@company.com"
                            }
                        }
                    }
                }
            },
            "default": {
                "actions": {
                    "Forward_To_General": {
                        "type": "SendEmail",
                        "inputs": {
                            "to": "support@company.com",
                            "subject": "[Language: @{body('Detect_Language')?['language']}] @{triggerBody()?['subject']}"
                        }
                    }
                }
            }
        }
    }
}
```

## Translation Workflow

```powerfx
// Detect language and translate if needed
ProcessMultilingualContent.OnSelect =
    Set(
        DetectedLang,
        AIBuilder.DetectLanguage(ContentText.Text)
    );

    If(
        DetectedLang.languageCode <> "en",
        // Translate to English for processing
        Set(
            TranslatedContent,
            // Use Microsoft Translator connector
            MicrosoftTranslator.Translate(
                ContentText.Text,
                "en",
                DetectedLang.languageCode
            )
        );
        Set(ProcessingText, TranslatedContent),
        Set(ProcessingText, ContentText.Text)
    );

    // Continue with English-based processing
    Set(
        Sentiment,
        AIBuilder.AnalyzeSentiment(ProcessingText)
    )
```

## Conclusion

Language detection enables:
- Intelligent multilingual routing
- Appropriate language-specific processing
- Global customer support automation
- Content localization workflows

## Resources

- [Language Detection Documentation](https://docs.microsoft.com/en-us/ai-builder/prebuilt-language-detection)

