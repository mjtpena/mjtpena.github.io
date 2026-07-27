---
title: "Building Skillsets in Azure Cognitive Search"
author: "Michael John Peña"
draft: false
date: 2022-08-30
tags: ["Azure", "Cognitive Search", "Skillsets", "AI Enrichment", "NLP"]

---

I wrote "Building Skillsets in Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## Skillset Architecture

A skillset consists of:
- **Skills**: Individual AI operations
- **Inputs**: Data sources for each skill
- **Outputs**: Results stored for indexing or further processing
- **Context**: The scope at which a skill operates

## Built-in Cognitive Skills

```python
from azure.search.documents.indexes import SearchIndexerClient
from azure.search.documents.indexes.models import (
    SearchIndexerSkillset,
    EntityRecognitionSkill,
    KeyPhraseExtractionSkill,
    LanguageDetectionSkill,
    SentimentSkill,
    PIIDetectionSkill,
    EntityLinkingSkill,
    OcrSkill,
    ImageAnalysisSkill,
    MergeSkill,
    SplitSkill,
    TextTranslationSkill,
    InputFieldMappingEntry,
    OutputFieldMappingEntry
)
from azure.core.credentials import AzureKeyCredential

endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")
indexer_client = SearchIndexerClient(endpoint=endpoint, credential=credential)

# Language Detection
language_skill = LanguageDetectionSkill(
    name="language-detection",
    description="Detect document language",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="languageCode", target_name="language")
    ]
)

# Entity Recognition
entity_skill = EntityRecognitionSkill(
    name="entity-recognition",
    description="Extract named entities",
    context="/document",
    categories=["Person", "Organization", "Location", "DateTime", "URL", "Email"],
    default_language_code="en",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content"),
        InputFieldMappingEntry(name="languageCode", source="/document/language")
    ],
    outputs=[
        OutputFieldMappingEntry(name="persons", target_name="persons"),
        OutputFieldMappingEntry(name="organizations", target_name="organizations"),
        OutputFieldMappingEntry(name="locations", target_name="locations"),
        OutputFieldMappingEntry(name="urls", target_name="urls"),
        OutputFieldMappingEntry(name="emails", target_name="emails")
    ]
)

# Key Phrase Extraction
keyphrase_skill = KeyPhraseExtractionSkill(
    name="keyphrase-extraction",
    description="Extract key phrases",
    context="/document",
    default_language_code="en",
    max_key_phrase_count=10,
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content"),
        InputFieldMappingEntry(name="languageCode", source="/document/language")
    ],
    outputs=[
        OutputFieldMappingEntry(name="keyPhrases", target_name="keyPhrases")
    ]
)

# Sentiment Analysis
sentiment_skill = SentimentSkill(
    name="sentiment-analysis",
    description="Analyze sentiment",
    context="/document",
    default_language_code="en",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content"),
        InputFieldMappingEntry(name="languageCode", source="/document/language")
    ],
    outputs=[
        OutputFieldMappingEntry(name="sentiment", target_name="sentiment"),
        OutputFieldMappingEntry(name="confidenceScores", target_name="sentimentScores")
    ]
)

# PII Detection
pii_skill = PIIDetectionSkill(
    name="pii-detection",
    description="Detect and redact PII",
    context="/document",
    default_language_code="en",
    pii_categories=["Email", "PhoneNumber", "CreditCardNumber", "SSN"],
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="piiEntities", target_name="piiEntities"),
        OutputFieldMappingEntry(name="maskedText", target_name="redactedContent")
    ]
)
```

## Image Processing Skills

```python
# OCR Skill
ocr_skill = OcrSkill(
    name="ocr-skill",
    description="Extract text from images",
    context="/document/normalized_images/*",
    default_language_code="en",
    detect_orientation=True,
    inputs=[
        InputFieldMappingEntry(name="image", source="/document/normalized_images/*")
    ],
    outputs=[
        OutputFieldMappingEntry(name="text", target_name="extractedText"),
        OutputFieldMappingEntry(name="layoutText", target_name="layoutText")
    ]
)

# Image Analysis Skill
image_analysis_skill = ImageAnalysisSkill(
    name="image-analysis",
    description="Analyze image content",
    context="/document/normalized_images/*",
    visual_features=["Tags", "Description", "Categories", "Faces", "Objects"],
    inputs=[
        InputFieldMappingEntry(name="image", source="/document/normalized_images/*")
    ],
    outputs=[
        OutputFieldMappingEntry(name="tags", target_name="imageTags"),
        OutputFieldMappingEntry(name="description", target_name="imageDescription"),
        OutputFieldMappingEntry(name="categories", target_name="imageCategories")
    ]
)

# Merge skill to combine OCR text
merge_skill = MergeSkill(
    name="merge-content",
    description="Merge text content with OCR results",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content"),
        InputFieldMappingEntry(name="itemsToInsert", source="/document/normalized_images/*/extractedText"),
        InputFieldMappingEntry(name="offsets", source="/document/normalized_images/*/contentOffset")
    ],
    outputs=[
        OutputFieldMappingEntry(name="mergedText", target_name="mergedContent")
    ]
)
```

## Text Processing Skills

```python
# Split Skill - for processing long documents
split_skill = SplitSkill(
    name="split-text",
    description="Split long documents into pages",
    context="/document",
    text_split_mode="pages",
    maximum_page_length=5000,
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="textItems", target_name="pages")
    ]
)

# Process each page
page_entity_skill = EntityRecognitionSkill(
    name="page-entity-recognition",
    context="/document/pages/*",  # Process each page
    categories=["Person", "Organization"],
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/pages/*")
    ],
    outputs=[
        OutputFieldMappingEntry(name="persons", target_name="persons"),
        OutputFieldMappingEntry(name="organizations", target_name="organizations")
    ]
)

# Translation Skill
translation_skill = TextTranslationSkill(
    name="translate-to-english",
    description="Translate content to English",
    context="/document",
    default_from_language_code="auto",
    default_to_language_code="en",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="translatedText", target_name="translatedContent")
    ]
)
```

## Creating the Complete Skillset

```python
# Combine all skills into a skillset
skillset = SearchIndexerSkillset(
    name="comprehensive-skillset",
    description="Full AI enrichment pipeline",
    skills=[
        language_skill,
        entity_skill,
        keyphrase_skill,
        sentiment_skill,
        pii_skill,
        ocr_skill,
        image_analysis_skill,
        merge_skill
    ],
    cognitive_services_account={
        "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
        "key": cognitive_services_key
    }
)

# Create or update skillset
indexer_client.create_or_update_skillset(skillset)
print(f"Skillset '{skillset.name}' created")
```

## Skillset Best Practices

```python
class SkillsetBuilder:
    """Helper class for building skillsets"""

    def __init__(self, name, cognitive_key):
        self.name = name
        self.cognitive_key = cognitive_key
        self.skills = []

    def add_language_detection(self):
        """Add language detection as first skill"""
        skill = LanguageDetectionSkill(
            name="detect-language",
            context="/document",
            inputs=[InputFieldMappingEntry(name="text", source="/document/content")],
            outputs=[OutputFieldMappingEntry(name="languageCode", target_name="language")]
        )
        self.skills.append(skill)
        return self

    def add_text_enrichment(self, include_pii=False):
        """Add standard text enrichment skills"""
        # Entity recognition
        self.skills.append(EntityRecognitionSkill(
            name="extract-entities",
            context="/document",
            inputs=[
                InputFieldMappingEntry(name="text", source="/document/content"),
                InputFieldMappingEntry(name="languageCode", source="/document/language")
            ],
            outputs=[
                OutputFieldMappingEntry(name="persons", target_name="persons"),
                OutputFieldMappingEntry(name="organizations", target_name="organizations"),
                OutputFieldMappingEntry(name="locations", target_name="locations")
            ]
        ))

        # Key phrases
        self.skills.append(KeyPhraseExtractionSkill(
            name="extract-keyphrases",
            context="/document",
            inputs=[
                InputFieldMappingEntry(name="text", source="/document/content"),
                InputFieldMappingEntry(name="languageCode", source="/document/language")
            ],
            outputs=[OutputFieldMappingEntry(name="keyPhrases", target_name="keyPhrases")]
        ))

        # Sentiment
        self.skills.append(SentimentSkill(
            name="analyze-sentiment",
            context="/document",
            inputs=[
                InputFieldMappingEntry(name="text", source="/document/content"),
                InputFieldMappingEntry(name="languageCode", source="/document/language")
            ],
            outputs=[OutputFieldMappingEntry(name="sentiment", target_name="sentiment")]
        ))

        if include_pii:
            self.skills.append(PIIDetectionSkill(
                name="detect-pii",
                context="/document",
                inputs=[InputFieldMappingEntry(name="text", source="/document/content")],
                outputs=[
                    OutputFieldMappingEntry(name="piiEntities", target_name="piiEntities"),
                    OutputFieldMappingEntry(name="maskedText", target_name="redactedContent")
                ]
            ))

        return self

    def add_image_processing(self):
        """Add image processing skills"""
        self.skills.append(OcrSkill(
            name="extract-image-text",
            context="/document/normalized_images/*",
            inputs=[InputFieldMappingEntry(name="image", source="/document/normalized_images/*")],
            outputs=[OutputFieldMappingEntry(name="text", target_name="extractedText")]
        ))

        self.skills.append(ImageAnalysisSkill(
            name="analyze-images",
            context="/document/normalized_images/*",
            visual_features=["Tags", "Description"],
            inputs=[InputFieldMappingEntry(name="image", source="/document/normalized_images/*")],
            outputs=[
                OutputFieldMappingEntry(name="tags", target_name="imageTags"),
                OutputFieldMappingEntry(name="description", target_name="imageDescription")
            ]
        ))

        return self

    def build(self):
        """Build the skillset"""
        return SearchIndexerSkillset(
            name=self.name,
            skills=self.skills,
            cognitive_services_account={
                "@odata.type": "#Microsoft.Azure.Search.CognitiveServicesByKey",
                "key": self.cognitive_key
            }
        )

# Usage
skillset = (SkillsetBuilder("my-skillset", cognitive_key)
    .add_language_detection()
    .add_text_enrichment(include_pii=True)
    .add_image_processing()
    .build())

indexer_client.create_or_update_skillset(skillset)
```

Skillsets enable powerful AI-driven content enrichment during the indexing process.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
