---
title: "AI Across the Microsoft Cloud: Choosing the Right Layer in 2021"
description: "A practitioner's map of AI and ML options across Azure, Power Platform and Microsoft 365 in early 2021, and how to pick the right layer for a problem."
author: Michael John Peña
draft: false
date: 2021-01-07
url: /blog/ai-across-the-microsoft-cloud/
images: 
     - /2021/01/Azure-AI-1-940x510.png
tags:
  - AI
  - Azure
  - Machine Learning
  - Cognitive Services
  - Power Platform
  - Synapse
---

Ask "how do we do AI on Microsoft?" and you'll get a different answer from every team you ask. A data scientist says Azure Machine Learning, a data engineer says Databricks or Synapse, a Power Platform maker says AI Builder, and someone from Microsoft 365 points at Designer in PowerPoint. They're all right, and that is the problem: there is no single tool, and choosing the wrong layer is how a three-week project turns into a six-month platform build.

I've spent the last two years working through this space and I'm still finding my way, because it moves fast. This is my map of it as of January 2021, organised by the question that matters most: how much of the model do you actually need to own?

## Four layers, one question

The way I sort the options is by ownership. The further down you go, the more control you get and the more you pay for it in skills, time and operations.

| Layer | You own | Typical products (January 2021) | Who builds it |
|---|---|---|---|
| Prebuilt AI | The integration | Azure Cognitive Services, Azure Cognitive Search, Azure Bot Service | App developers |
| Low-code AI | The data and the business logic | AI Builder, Power BI AutoML, Power Virtual Agents, Dynamics 365 Customer Insights | Analysts and makers |
| Custom ML platform | The model and its lifecycle | Azure Machine Learning, Azure Databricks, Azure Synapse Analytics | Data scientists and ML engineers |
| Infrastructure | Everything | GPU VMs, AKS, Azure Stack Edge, SQL Server Machine Learning Services | Platform teams |

My rule of thumb: start at the top and only move down when you can name the specific thing the layer above can't do. "We want more control" isn't a reason. "The prebuilt OCR model can't read our handwritten delivery dockets and Custom Vision isn't the right shape either" is.

## Prebuilt AI: Cognitive Services and friends

Azure Cognitive Services is where most organisations should start. You call a REST API or a native SDK (.NET, Python, Java, JavaScript and others) and get a result back, with no training infrastructure to run. The catalogue is grouped into four families:

- **Vision**: [Computer Vision](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/overview) (including OCR), Custom Vision, Face, Video Indexer and Form Recognizer, which went GA in mid-2020 for extracting text, key-value pairs and tables from forms.
- **Speech**: speech-to-text, text-to-speech, speech translation and custom speech models. This is an area I'm personally involved in, and neural text-to-speech is the part I'd watch: synthetic voices are getting much harder to tell apart from real ones.
- **Language**: Text Analytics, Language Understanding (LUIS), QnA Maker and Translator.
- **Decision**: Anomaly Detector (GA since September 2020), Content Moderator, Personalizer, and Metrics Advisor, which was announced in public preview at Ignite in September 2020.

Deployment is where I see teams rule this layer out too early. Most services are pay-per-call, and a growing subset can run in [Docker containers](/blog/2020-12-04-azure-cognitive-services-containers/) when data can't leave your network.

I treat Cognitive Search and Bot Service as part of this layer because the intelligence in both comes from Cognitive Services. You configure and integrate them; you don't train anything.

### Azure Cognitive Search

**Azure Cognitive Search** with AI enrichment is Microsoft's answer to "knowledge mining": an indexer pulls documents from storage, a [skillset](/blog/2020-11-14-azure-cognitive-search-skills/) runs OCR, entity recognition and key-phrase extraction over them, and the enriched output lands in a searchable index. For contracts, audit evidence and support archives, it beats a custom model on effort.

### Azure Bot Service

**Azure Bot Service** hosts conversational bots and publishes them to channels such as Teams, Slack, Telegram and web chat. Bot Framework Composer, which reached GA at Build in May 2020, lets you design much of the dialog visually and wire in LUIS and QnA Maker. It's low-code, not no-code. You'll still write code once the bot has to call your own systems.

**When not to use this layer:** when your domain is unusual enough that a general model is consistently wrong, or when the per-call price at your volume is more than hosting a model yourself would cost. Do that arithmetic early.

## Low-code AI: Power Platform, Power BI, Dynamics 365 and Microsoft 365

### Power Platform and Dynamics 365

**AI Builder** brings prebuilt models (business card reader, text recognition, sentiment) and trainable models (prediction, form processing, object detection, category classification) into Power Apps and Power Automate. Its value isn't the models themselves. It's that authentication, data access and deployment are inherited from the Power Platform environment, so an app that reads invoices can be in front of users in days.

**Power BI** has two AI features that are easy to mix up. AI Insights in Power Query calls Cognitive Services (sentiment, key phrases, image tagging) and published Azure ML models from within a transformation. Automated ML in dataflows trains [binary prediction, classification and regression models](https://learn.microsoft.com/en-us/power-bi/transform-model/dataflows/dataflows-machine-learning-integration) on your dataflow data, using Azure ML's AutoML under the hood. It needs Premium or Embedded capacity, and it doesn't do time-series forecasting. If someone tells you it does, check what they're actually using.

**Power Virtual Agents** (GA since December 2019) is the maker-friendly route to a bot, built on the same Bot Framework foundation. **Dynamics 365 Customer Insights** unifies customer data from several sources into a single profile and adds AI-driven predictions on top. If your goal is "a single view of the customer" and you're already on Dynamics 365, look at it before building one in a data warehouse.

### Microsoft 365

Some of the most-used AI in the Microsoft cloud doesn't look like AI at all. **PowerPoint Designer** suggests slide layouts from your content, and **Presenter Coach** gives feedback on pace, filler words and reading off the slides. There's nothing to configure or govern, so if the need is personal productivity inside Office, use these and don't build anything.

**SharePoint Syntex**, the first product out of Project Cortex, went GA on 1 October 2020. It brings two model types into SharePoint document libraries: document understanding models, which classify documents and extract fields from unstructured files such as contracts, and form processing models, which extract data from structured forms and are built on AI Builder. Subject-matter experts train them from a handful of examples in a SharePoint content centre, and the extracted values land as library metadata.

My split between Syntex and AI Builder is about where the documents live and where the output goes. If the documents already sit in SharePoint and the goal is classification, metadata and retention, Syntex fits. If the extracted data has to drive an app or a flow into another system, AI Builder in Power Automate is the better home.

Cost often decides between these layers more than capability does. Cognitive Services bill per transaction, so cost grows in a straight line with volume. AI Builder consumes capacity credits, sold as an add-on to Power Platform licences, so a high-volume form flow can quietly use up its allocation. Power BI AutoML needs Premium or Embedded capacity, which is easy to justify if you already have it and hard if you don't. With Azure ML you mainly pay for the compute you run, which is cheaper per prediction at scale but comes with people and operations costs that don't show up on the Azure bill.

**When not to use this layer:** when the model is the product. If accuracy, explainability or retraining cadence are things you'll have to defend to a regulator or a customer, you need the lifecycle control of the next layer.

## Custom ML platforms: Azure ML, Databricks and Synapse

This is where most of the confusion is, because all three run notebooks, all three run Spark or Python, and all three can train a model. The difference is the centre of gravity.

### Azure Machine Learning

[Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/overview-what-is-azure-machine-learning) is the one built around the model lifecycle. Notebooks run on managed compute instances, training runs on compute clusters, and every run, dataset and model is tracked in the workspace. The studio web experience, the drag-and-drop designer (the successor to the classic ML Studio) and the AutoML UI were all made generally available at Ignite 2020 (the [release notes](https://learn.microsoft.com/en-us/azure/machine-learning/azure-machine-learning-release-notes) track the SDK side of each change). For MLOps, pipelines plus Azure DevOps or GitHub Actions let you retrain, register and deploy in the same CI/CD flow you use for applications. I've covered [automated ML](/blog/2020-11-11-azure-ml-automated-ml/) separately.

If you have a dedicated data science team, this is the default. Its weakness is large-scale data engineering, which is not what it was designed for.

### Azure Databricks

Databricks is the strongest choice when the data work dominates the ML work. You get managed Spark, the ML runtime with the common frameworks preinstalled, and managed MLflow for experiment tracking and a model registry. I'd describe it as "big data first, ML as a natural extension".

I wouldn't use it when data volumes are small and nobody in the team knows Spark. Then you're paying for clusters and learning a distributed engine to do work that Azure ML compute clusters handle more simply.

### Azure Synapse Analytics

Synapse became [generally available in December 2020](/blog/2020-12-05-azure-synapse-analytics-ga/), bringing dedicated SQL pools (the former Azure SQL Data Warehouse), serverless SQL and Apache Spark pools into one workspace. It's "analytics first, ML as a by-product". Spark pools can train models, and integration with Azure ML (including launching AutoML runs from a Synapse workspace) was in preview at GA. I'd pick it for ML when the warehouse is already in Synapse and the models are modest. I wouldn't pick it as an ML platform in its own right yet.

Two Spark-adjacent notes. **.NET for Apache Spark** reached v1.0 in October 2020, so C# and F# teams can write Spark jobs without switching to Python or Scala, and Synapse notebooks support .NET (C#) as a language. And **HDInsight** is still a good managed home for Spark, Hadoop, Kafka and HBase, but its ML Services (R Server) cluster type [reached end of support on 31 December 2020](https://github.com/hdinsight/release-notes/releases/tag/2020-11-09). Don't start anything new on it.

### Working outside a hosted workspace

The **Data Science Virtual Machine** is a prebuilt Windows or Ubuntu image with Python, R, Jupyter and the common frameworks already installed. You get full control and can deallocate it when you're done. It's good for individuals and short experiments. For a team, I'd rather have Azure ML compute instances, which bring access control and run tracking.

Locally, **VS Code** with the Python and Jupyter extensions gives you a native notebook experience against your own kernel. That's enough for small datasets and quick checks, and since the hosted Azure Notebooks preview was retired in October 2020, it's also the obvious replacement. **GitHub Codespaces** can run the same setup in the cloud, but it's still in limited public beta, so treat it as something to try rather than something to standardise on.

For **ML.NET** (1.5.4 as of December 2020), C# and F# developers can train and consume models with Model Builder and the CLI's AutoML without leaving .NET. It's a sensible choice when the model ships inside a .NET application and the team has no Python skills to lean on.

## Infrastructure: where the model runs

Eventually a model has to run somewhere. The options, from most managed to least:

- **Azure Container Instances** for dev/test and low-volume scoring. Azure ML can deploy here directly.
- **App Service (Web App for Containers)** when you already have an App Service plan and the model is light.
- **Azure Kubernetes Service** for production inference at scale, and the target Azure ML is designed around for real-time endpoints. It also gives you the most operational work.
- **Azure Container Registry** underneath all three, versioned in line with your MLOps pipeline.

For training, the NC, ND and NDv2 GPU VM families cover most deep learning work, and the A100-based ND A100 v4 is in preview. Azure ML can also deploy a small set of image models to FPGAs, which is a niche option for very low-latency vision inference.

**SQL Server Machine Learning Services** deserves a mention for the opposite reason: it brings the model to the data. R has been supported since SQL Server 2016 and Python since 2017, run in-database through `sp_execute_external_script`. If your training data and scoring both live in SQL Server, moving that data out to a separate platform is often the bigger risk.

At the edge, **Azure Stack Edge Pro with GPU** puts compute and an NVIDIA T4 GPU on site for local inference, which matters for video and other data you can't or shouldn't stream to the cloud. I've worked with Azure Stack Edge and the performance impressed me. I think hybrid is where much of enterprise AI ends up, because not every workload belongs in a public cloud region.

## How I'd decide

- **Start with Cognitive Services** and prove the problem is worth solving before you train anything.
- **Use the low-code layer** when the people who understand the problem are analysts and makers, not data scientists. Use the Microsoft 365 features first when the documents already live in SharePoint or the need is personal productivity.
- **Pick Azure ML** when the model is the asset and needs a governed lifecycle. Pick Databricks when the data engineering is the hard part. Use Synapse for ML when your warehouse is already there and the models are modest.
- **Check what's being retired** before you design around it. HDInsight ML Services and Azure Notebooks both ended in 2020.
- **Plan inference before training.** Where the model runs (ACI, AKS, SQL Server or the edge) often constrains the design more than how it was trained.

There's no single tool for AI on Microsoft's cloud, and I don't think there should be. The skill is knowing which layer a problem belongs in.
