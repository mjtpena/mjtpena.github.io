---
title: "Mobile AI Development: Building Intelligent Mobile Apps"
author: Michael John Peña
draft: false
date: 2025-04-10
tags:
  - Mobile
  - AI
  - iOS
  - Android
  - Development

---

I wrote "Mobile AI Development: Building Intelligent Mobile Apps" to share practical, production-minded guidance on this topic.

## Mobile AI Implementation

```swift
// iOS - Core ML Integration
import CoreML
import NaturalLanguage

class MobileAIService {
    private var textClassifier: NLModel?
    private var embeddingModel: MLModel?

    func initialize() async throws {
        // Load Core ML models
        let config = MLModelConfiguration()
        config.computeUnits = .all  // Use Neural Engine when available

        embeddingModel = try await MLModel.load(
            contentsOf: Bundle.main.url(forResource: "TextEmbedding", withExtension: "mlmodelc")!,
            configuration: config
        )

        // Load NL model for classification
        textClassifier = try NLModel(contentsOf:
            Bundle.main.url(forResource: "SentimentClassifier", withExtension: "mlmodelc")!
        )
    }

    func classifySentiment(_ text: String) -> String? {
        return textClassifier?.predictedLabel(for: text)
    }

    func getEmbedding(_ text: String) async throws -> [Float] {
        let input = TextEmbeddingInput(text: text)
        let output = try await embeddingModel?.prediction(from: input)
        return output?.embedding ?? []
    }
}

// On-device RAG
class LocalRAG {
    private let embeddingService: MobileAIService
    private var vectorStore: [(embedding: [Float], text: String)] = []

    func addDocument(_ text: String) async throws {
        let embedding = try await embeddingService.getEmbedding(text)
        vectorStore.append((embedding, text))
    }

    func search(_ query: String, topK: Int = 5) async throws -> [String] {
        let queryEmbedding = try await embeddingService.getEmbedding(query)

        let results = vectorStore
            .map { (cosineSimilarity(queryEmbedding, $0.embedding), $0.text) }
            .sorted { $0.0 > $1.0 }
            .prefix(topK)
            .map { $0.1 }

        return Array(results)
    }

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        let dotProduct = zip(a, b).map(*).reduce(0, +)
        let magnitudeA = sqrt(a.map { $0 * $0 }.reduce(0, +))
        let magnitudeB = sqrt(b.map { $0 * $0 }.reduce(0, +))
        return dotProduct / (magnitudeA * magnitudeB)
    }
}
```

```kotlin
// Android - ML Kit and TensorFlow Lite
import com.google.mlkit.nl.languageid.LanguageIdentification
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer

class AndroidAIService(private val context: Context) {
    private lateinit var tfliteInterpreter: Interpreter

    fun initialize() {
        val modelFile = loadModelFile("text_embedding.tflite")
        val options = Interpreter.Options().apply {
            setNumThreads(4)
            setUseNNAPI(true)  // Use Neural Network API
        }
        tfliteInterpreter = Interpreter(modelFile, options)
    }

    suspend fun getEmbedding(text: String): FloatArray {
        val inputBuffer = tokenize(text)
        val outputBuffer = Array(1) { FloatArray(384) }

        tfliteInterpreter.run(inputBuffer, outputBuffer)
        return outputBuffer[0]
    }

    suspend fun detectLanguage(text: String): String {
        return suspendCoroutine { continuation ->
            LanguageIdentification.getClient()
                .identifyLanguage(text)
                .addOnSuccessListener { languageCode ->
                    continuation.resume(languageCode)
                }
        }
    }
}
```

Mobile AI brings powerful intelligence to users while respecting privacy and working offline.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
