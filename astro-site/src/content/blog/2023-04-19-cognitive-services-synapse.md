---
title: "Cognitive Services in Azure Synapse: Built-in AI Capabilities"
description: "Cognitive Services in Synapse brings AI capabilities directly into your data engineering workflows. Process millions of records with sentiment, entities…"
author: Michael John Pena
draft: false
date: 2023-04-19
tags:
  - Azure
  - Synapse
  - Cognitive Services
  - AI
  - Data Engineering
---

## Synapse Cognitive Services Setup

```python
# Synapse notebook with Cognitive Services
from synapse.ml.cognitive import *
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, explode

# Cognitive Services configuration
cognitive_key = mssparkutils.credentials.getSecret("keyvault", "cognitive-key")
cognitive_endpoint = "https://your-cognitive.cognitiveservices.azure.com/"

class SynapseCognitiveServices:
    """Cognitive Services integration for Synapse."""

    def __init__(self, spark: SparkSession, key: str, endpoint: str):
        self.spark = spark
        self.key = key
        self.endpoint = endpoint

    def analyze_sentiment(self, df, text_column: str, output_column: str = "sentiment"):
        """Analyze sentiment of text column."""
        from synapse.ml.cognitive import TextSentiment

        sentiment = (TextSentiment()
            .setTextCol(text_column)
            .setUrl(f"{self.endpoint}text/analytics/v3.1/sentiment")
            .setSubscriptionKey(self.key)
            .setOutputCol(output_column)
            .setErrorCol("sentiment_error"))

        return sentiment.transform(df)

    def extract_entities(self, df, text_column: str, output_column: str = "entities"):
        """Extract named entities from text."""
        from synapse.ml.cognitive import NER

        ner = (NER()
            .setTextCol(text_column)
            .setUrl(f"{self.endpoint}text/analytics/v3.1/entities/recognition/general")
            .setSubscriptionKey(self.key)
            .setOutputCol(output_column)
            .setErrorCol("ner_error"))

        return ner.transform(df)

    def extract_key_phrases(self, df, text_column: str, output_column: str = "key_phrases"):
        """Extract key phrases from text."""
        from synapse.ml.cognitive import KeyPhraseExtractor

        extractor = (KeyPhraseExtractor()
            .setTextCol(text_column)
            .setUrl(f"{self.endpoint}text/analytics/v3.1/keyPhrases")
            .setSubscriptionKey(self.key)
            .setOutputCol(output_column)
            .setErrorCol("keyphrase_error"))

        return extractor.transform(df)

# Initialize
cog = SynapseCognitiveServices(spark, cognitive_key, cognitive_endpoint)
```

## Sentiment Analysis at Scale

```python
class SentimentPipeline:
    """Scalable sentiment analysis pipeline."""

    def __init__(self, cognitive_services):
        self.cog = cognitive_services

    def analyze_customer_feedback(self, df):
        """Analyze customer feedback sentiment."""

        # Apply sentiment analysis
        result = self.cog.analyze_sentiment(df, "feedback_text")

        # Extract sentiment scores
        from pyspark.sql.functions import col

        result = result.select(
            col("customer_id"),
            col("feedback_text"),
            col("feedback_date"),
            col("sentiment.document.sentiment").alias("overall_sentiment"),
            col("sentiment.document.confidenceScores.positive").alias("positive_score"),
            col("sentiment.document.confidenceScores.negative").alias("negative_score"),
            col("sentiment.document.confidenceScores.neutral").alias("neutral_score")
        )

        return result

    def batch_process_reviews(self, source_table: str, target_table: str):
        """Process reviews in batches."""

        # Read source data
        df = spark.table(source_table)

        # Process in chunks for large datasets
        batch_size = 10000
        total_rows = df.count()

        for offset in range(0, total_rows, batch_size):
            batch_df = df.limit(batch_size).offset(offset)
            result = self.analyze_customer_feedback(batch_df)

            # Write to target
            result.write.mode("append").saveAsTable(target_table)

            print(f"Processed {min(offset + batch_size, total_rows)}/{total_rows} rows")

    def aggregate_sentiment_metrics(self, sentiment_df) -> dict:
        """Aggregate sentiment metrics."""

        from pyspark.sql.functions import avg, count, when

        metrics = sentiment_df.agg(
            count("*").alias("total_reviews"),
            avg("positive_score").alias("avg_positive"),
            avg("negative_score").alias("avg_negative"),
            count(when(col("overall_sentiment") == "positive", 1)).alias("positive_count"),
            count(when(col("overall_sentiment") == "negative", 1)).alias("negative_count"),
            count(when(col("overall_sentiment") == "neutral", 1)).alias("neutral_count")
        ).collect()[0]

        return metrics.asDict()

# Usage
pipeline = SentimentPipeline(cog)
reviews_df = spark.table("bronze.customer_reviews")
sentiment_df = pipeline.analyze_customer_feedback(reviews_df)
sentiment_df.write.mode("overwrite").saveAsTable("silver.review_sentiments")
```

## Entity Extraction Pipeline

```python
class EntityExtractionPipeline:
    """Extract and categorize entities at scale."""

    def __init__(self, cognitive_services):
        self.cog = cognitive_services

    def extract_and_flatten_entities(self, df, text_column: str):
        """Extract entities and flatten results."""

        # Apply NER
        result = self.cog.extract_entities(df, text_column)

        # Flatten entity results
        from pyspark.sql.functions import explode, col

        flattened = result.select(
            col("id"),
            col(text_column),
            explode(col("entities.document.entities")).alias("entity")
        ).select(
            col("id"),
            col(text_column),
            col("entity.text").alias("entity_text"),
            col("entity.category").alias("entity_category"),
            col("entity.subcategory").alias("entity_subcategory"),
            col("entity.confidenceScore").alias("confidence")
        )

        return flattened

    def build_entity_graph(self, entity_df):
        """Build entity co-occurrence graph."""

        from pyspark.sql.functions import collect_set

        # Group entities by document
        doc_entities = entity_df.groupBy("id").agg(
            collect_set("entity_text").alias("entities")
        )

        # Create entity pairs
        from pyspark.sql.functions import explode, array, struct

        entity_pairs = doc_entities.select(
            explode(
                self._generate_pairs(col("entities"))
            ).alias("pair")
        ).select(
            col("pair.entity1"),
            col("pair.entity2")
        )

        # Count co-occurrences
        co_occurrence = entity_pairs.groupBy("entity1", "entity2").count()

        return co_occurrence

    def categorize_documents(self, df, text_column: str):
        """Categorize documents based on entities."""

        entities = self.extract_and_flatten_entities(df, text_column)

        # Pivot entity categories
        from pyspark.sql.functions import count

        category_counts = entities.groupBy("id").pivot("entity_category").agg(
            count("entity_text")
        ).na.fill(0)

        # Join back with original
        return df.join(category_counts, "id", "left")

# Usage
entity_pipeline = EntityExtractionPipeline(cog)
articles_df = spark.table("bronze.news_articles")
entities_df = entity_pipeline.extract_and_flatten_entities(articles_df, "article_text")
entities_df.write.mode("overwrite").saveAsTable("silver.article_entities")
```

## Translation Pipeline

```python
class TranslationPipeline:
    """Multi-language translation at scale."""

    def __init__(self, spark, translator_key: str, translator_endpoint: str):
        self.spark = spark
        self.key = translator_key
        self.endpoint = translator_endpoint

    def translate_column(
        self,
        df,
        text_column: str,
        target_language: str = "en",
        output_column: str = "translated"
    ):
        """Translate text column to target language."""

        from synapse.ml.cognitive import Translate

        translator = (Translate()
            .setTextCol(text_column)
            .setToLanguage([target_language])
            .setUrl(self.endpoint)
            .setSubscriptionKey(self.key)
            .setOutputCol(output_column)
            .setErrorCol("translation_error"))

        result = translator.transform(df)

        # Extract translated text
        result = result.withColumn(
            output_column,
            col(f"{output_column}")[0]["translations"][0]["text"]
        )

        return result

    def detect_language(self, df, text_column: str, output_column: str = "detected_language"):
        """Detect language of text."""

        from synapse.ml.cognitive import LanguageDetector

        detector = (LanguageDetector()
            .setTextCol(text_column)
            .setUrl(f"{self.endpoint.replace('translator', 'text/analytics')}/v3.1/languages")
            .setSubscriptionKey(self.key)
            .setOutputCol(output_column)
            .setErrorCol("detection_error"))

        return detector.transform(df)

    def translate_multilingual_dataset(
        self,
        df,
        text_column: str,
        target_language: str = "en"
    ):
        """Translate multi-language dataset to single language."""

        # First detect languages
        with_language = self.detect_language(df, text_column)

        # Filter non-target language rows
        needs_translation = with_language.filter(
            col("detected_language.document.detectedLanguage.iso6391Name") != target_language
        )

        already_target = with_language.filter(
            col("detected_language.document.detectedLanguage.iso6391Name") == target_language
        ).withColumn("translated", col(text_column))

        # Translate
        translated = self.translate_column(needs_translation, text_column, target_language)

        # Union results
        return already_target.unionByName(translated, allowMissingColumns=True)

# Usage
translator = TranslationPipeline(spark, translator_key, translator_endpoint)
multilingual_df = spark.table("bronze.international_reviews")
english_df = translator.translate_multilingual_dataset(multilingual_df, "review_text", "en")
```

## Computer Vision in Synapse

```python
class SynapseComputerVision:
    """Computer Vision integration for image processing."""

    def __init__(self, spark, vision_key: str, vision_endpoint: str):
        self.spark = spark
        self.key = vision_key
        self.endpoint = vision_endpoint

    def analyze_images(self, df, image_url_column: str):
        """Analyze images and extract features."""

        from synapse.ml.cognitive import AnalyzeImage

        analyzer = (AnalyzeImage()
            .setImageUrlCol(image_url_column)
            .setUrl(f"{self.endpoint}vision/v3.2/analyze")
            .setSubscriptionKey(self.key)
            .setVisualFeatures(["Categories", "Tags", "Description", "Objects"])
            .setOutputCol("analysis")
            .setErrorCol("vision_error"))

        return analyzer.transform(df)

    def extract_text_from_images(self, df, image_url_column: str):
        """Extract text from images using OCR."""

        from synapse.ml.cognitive import OCR

        ocr = (OCR()
            .setImageUrlCol(image_url_column)
            .setUrl(f"{self.endpoint}vision/v3.2/ocr")
            .setSubscriptionKey(self.key)
            .setOutputCol("ocr_result")
            .setErrorCol("ocr_error"))

        result = ocr.transform(df)

        # Flatten OCR results
        return result.withColumn(
            "extracted_text",
            self._flatten_ocr_text(col("ocr_result"))
        )

    def generate_image_captions(self, df, image_url_column: str):
        """Generate captions for images."""

        analyzed = self.analyze_images(df, image_url_column)

        return analyzed.withColumn(
            "caption",
            col("analysis.description.captions")[0]["text"]
        ).withColumn(
            "caption_confidence",
            col("analysis.description.captions")[0]["confidence"]
        )

# Usage
vision = SynapseComputerVision(spark, vision_key, vision_endpoint)
products_df = spark.table("bronze.product_images")
analyzed_df = vision.generate_image_captions(products_df, "image_url")
```

## Unified AI Pipeline

```python
class UnifiedAIPipeline:
    """Combined Cognitive Services pipeline."""

    def __init__(self, spark, config: dict):
        self.spark = spark
        self.sentiment = SynapseCognitiveServices(
            spark, config["text_key"], config["text_endpoint"]
        )
        self.vision = SynapseComputerVision(
            spark, config["vision_key"], config["vision_endpoint"]
        )

    def process_social_media_posts(self, df):
        """Process social media posts with text and images."""

        # Separate text-only and image posts
        text_only = df.filter(col("image_url").isNull())
        with_images = df.filter(col("image_url").isNotNull())

        # Process text
        text_analyzed = self.sentiment.analyze_sentiment(text_only, "post_text")
        text_analyzed = self.sentiment.extract_entities(text_analyzed, "post_text")

        # Process images
        image_analyzed = self.vision.analyze_images(with_images, "image_url")
        image_analyzed = self.sentiment.analyze_sentiment(image_analyzed, "post_text")

        # Combine results
        return text_analyzed.unionByName(image_analyzed, allowMissingColumns=True)

# Usage
pipeline = UnifiedAIPipeline(spark, {
    "text_key": cognitive_key,
    "text_endpoint": cognitive_endpoint,
    "vision_key": vision_key,
    "vision_endpoint": vision_endpoint
})

social_df = spark.table("bronze.social_media_posts")
enriched_df = pipeline.process_social_media_posts(social_df)
enriched_df.write.mode("overwrite").saveAsTable("silver.enriched_social_posts")
```

Cognitive Services in Synapse brings AI capabilities directly into your data engineering workflows. Process millions of records with sentiment, entities, translation, and vision without leaving your Spark environment.
