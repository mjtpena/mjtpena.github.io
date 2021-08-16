---
title: AI across the Microsoft Cloud
author: MJ Peña
draft: false
date: 2021-01-07T09:07:24+00:00
url: /blog/ai-across-the-microsoft-cloud/
images: 
     - /2021/01/Azure-AI-1-940x510.png
tags:
  - Technology
tags:
  - artificial intelligence
  - azure
  - Data Science
  - Databricks
  - machine learning
  - Microsoft Cloud
  - MLOps
  - Power Platform
  - Synapse
---

Artificial Intelligence (AI) and Machine Learning (ML) are trending topics right now. In 2021, there are countless of ways to have a form of "AI" in your apps and platforms. A lot of companies from startups to software giants offer services that relate to this space. I spent the last 2 years exploring this space, and I still swimming my way as the movements in this area are quick and it's hard to keep up.

Microsoft is a leader in this space, specially in AI for Enterprise, as they offer a variety of options depending on your needs and choice of approach. In the Microsoft Cloud space (Azure, Microsoft 365, and other related products), it's very easy to get confused as there is no "one tool to rule them all" as a market fit. In my experience, there isn't really one silver bullet "yet" in this game, since unique problems require different approaches. The actual value of AI is when it solves a problem, and technologies and platforms successfully enable this outcome.

This is my attempt to create an ultimate rundown of navigating AI in the Microsoft Cloud. Let's start with platforms that allow Data Scientists develop ML models. There are times I need to wear this "Data Scientist" or "Data Engineer" hat when some ML models that we are developing are relatively common, but some `really` difficult ML problems require a lot of research, experimentation, deep-expertise, and resources. Having a unified and seamless workspace is what you need in order to be productive in creating and training models.

![img](/2021/01/Azure-AI-1-1024x794.png)

## Machine Learning Workspace

![img](/2021/01/Screen-Shot-2021-01-07-at-16.16.16.png)

#### Azure Machine Learning

This is an end-to-end platform and workspace for all bespoke AI and ML development. This platform has the balance of flexibility but, not too general, as this still taps on with specific "fit-for-purpose" ML tools.

- **Notebooks**. Arguably, the modern way to deal with ML, is by using a Jupyter notebook. Azure ML allows you to use the same experience as you have with any other Jupyter server instance, but with roles and underlying infrastructure abstracted.
- **ML Designer**. The previous iteration of this is called "ML Studio". This drag-and-drop flow-chart-like capability is also available in Azure ML in case you prefer this rather than using notebooks.
- **Automated ML**. Some ML problems like simple classification can easily be captured using AutoML. This feature focuses on the common problems that may have already been solved before, so you can focus your team's energy on the harder problems.
- **MLOps**. This is one step further in making your ML life-cycle more mature. Having this maturity of proper version control using Git and workflows allow you to automate training and experimentation in CI/CD fashion - just like how you stage web applications.

There are a lot of other things that Azure ML can do especially in the integrations space. Mature and companies with dedicated AI team(s) should seriously explore this. If you want to learn more about Azure ML, [click here][1].

![img](/2021/01/Screen-Shot-2021-01-07-at-16.18.13.png)

#### Data Science VM

Well, in all honesty, you can use any Virtual Machine for your ML workflow. Actually, any machine at all from any cloud or hardware provider. However, unless you have DSC (desired state configuration) setup per instance, then you have to install Python, Jupyter, Anaconda, etc. DSVM is a ready-made image that comes with a lot of pre-installed tools that an AI scientist or engineer would use. The beauty of this approach is you have full control of that machine and can turn it off anytime. [Learn more][2].

![img](https://miro.medium.com/max/1200/1*tkxMr0bjfYUHS0nGqQtX8A.png)

#### Notebooks in VS Code

Sometimes you prefer to do some simple experiments locally on your machine instead of a hosted Jupyter kernel instance. Maybe you're using a beefy desktop and want to experiment on simple models and small datasets, then having that offline experience of Jupyter notebook is available in VS Code. [Learn more][3].

Bonus: Notebooks extension is also available on [Github Codespaces][4]. Go explore. 😉

## Complements with MLOps

The next part I want to cover are products and services that are "related" to ML, but it's not the primary focus. One way or the other, you can create an ML model based from a dataset and use it for any purpose that it may serve.

#### Apache Spark™

The reason I would argue that any service related to Spark™ would fall into the "big data" category and as a byproduct, can host an ML server that comes with Python based frameworks (MLlib, TensorFlow, PyTorch, and scikit-learn to name a few.)

![img](/2021/01/image.png)

##### Azure Databricks

Databricks creates a unified environment for your big data analytics. Similar to Azure ML, this is more than just a Spark™ cluster. It also comes with notebooks, managed infrastructure, and native integrations with other Azure services. I would argue that Databricks can really be your prime-time production workspace, but then again, it's more positioned as "more big data, ML as a byproduct." [Learn more][5].

![img](/2021/01/image-1-1024x937.png)

##### **Azure HDInsight**

It also has a managed Spark™ cluster capability hence comes with MLlib (machine learning library), but beyond that it also has support for Hadoop, Kafka, HBase. HDInsight is really useful in "crunching enormous set of unstructured/semi-structured data" and is more for the big data scenarios. The ML capabilities are currently limited. [Learn more][6].

![img](/2021/01/net-for-apache-spark-horiz.png)

##### **.NET for Apache Spark™**

The popular ways to interface with a Spark™ instance is by using Python and Scala. The .NET team created an open-source high performance bindings that is compliant with .NET Standard that will allow you to perform Spark™ operations in any .NET apps using C# or F#. [Learn more][7].

![img](/2021/01/image-2-1016x1024.png)

#### Azure Synapse Analytics

This is the new kid in the block that developed from Azure SQL Data Warehouse. Similar to Databricks, Synapse also offers an end-to-end pipeline and workflows for your modern data warehouse needs. Data warehousing has developed from traditional "housing of data" to creating unified and real-time data analytics. Synapse really shines when you're dealing with a lot (even petabyte) of diverse and unstructured data and wants to gain meaningful insights out of it. As part of this approach, Synapse also overlaps (and co-exists) with ML services. You have the option to use the ML capabilities of the dedicated pools of Spark™ and SQL instances or integrate with Azure ML and Power BI. I would argue that Synapse is "more data analytics, ML as a byproduct." [Learn more][8].

![img](/2021/01/newpowerbiicon.jpg)

#### **Power BI**

This is your go-to tool when creating meaningful dashboards and reports from your data. As part of this, Power BI also comes with features that allow you to go beyond visualisation like creating semantic (structured table-like) data models. In the ML side of things, Power BI comes with "Dataflows" that allows you to select a data source to generate and train an ML model with "AI Insights" using AutoML under the hood. This works in some scenarios such as time-series forecasting. I would say that Power BI is "more data visualisation, ML and Big Data as byproducts." [Learn more][9].

## AI Apps and Agents

In this section, I will cover "AI infused" functionalities that are more application-driven. These products and services are very powerful as these have the least barrier of entry and abstracts some complexities of AI/ML operations such as setting up infrastructure, access to deep knowledge of AI scientists, and sometimes cost efficiency to name a few.

![img](/2021/01/image-4-1024x685.png)

#### Azure Cognitive Services

These set of services allow you to add intelligence to your apps. Throughout the years, it has developed in to a lot of general purpose service offerings and specialised AI & ML use-cases that fit your business needs or problems you're trying to solve. The beauty of Cognitive Services is that it's very easy to get started and a lot of it can be accessed in either a form of API, Native SDKs (.NET, JavaScript, Java, Python, etc), or intuitive graphical portals. The deployment model is also very flexible, from hosted consumption (pay-per-hit) to containerised instances.

- **Vision**. If you want to create a simple facial recognition system, this is something to explore. You can even do advanced OCR (Optical Character recognitions) like Form Recognizer. Analyse videos using Video Indexer. And analysing image contents using Computer and Custom vision.
- **Speech**. There are a lot of things that you can do with Speech. From simple speech-to-text & text-to-speech, to real-time translations of a voice. Imagine speaking a language or having your own narration that doesn't sound "too robot like." There are a lot of exciting things happening in this space that I am involved too, so watch this space.
- **Language**. In parallel with speech, _Language_ also provides a lot of texts related insights, mostly coming from unstructured texts. From text-to-text translations (even a document file) to complex NLP (Natural Language Processing) problems with Language Understanding.
- **Decision**. This set of services allows you to create ML models to enable smarter decisions. From simple anomaly detectors, content moderator, content personaliser, and metrics advisor.

They add more services from time to time, as some emerging AI disciplines are becoming democratised. To learn more about Azure Cognitive Services, [click here][10].

![img](/2021/01/image-6-1024x687.png)

#### Knowledge Mining

Sometimes these services are the things we take for granted on how easy it is now to perform, but it would take a lot of research and resources to do decades ago. A more evolved form of cognitive service is a new offering called **Knowledge Mining** with **Azure Cognitive Search.** Knowledge mining is an emerging discipline in AI where you use a combination of intelligent services to quickly create insights from your company data sources. Imagine ingesting all of your historical documents, database records, other unstructured data and explore meaningful insights about it - create an audit & risk compliance, managing contracts, customer support, and a lot more! [Learn more][11].

![img](/2021/01/image-7-1024x930.png)

#### **Azure Bot Service**

This is a managed service that allows you to create bots (like chatbots). This also allows you to integrate and deploy to popular channels such as Teams, Slack, Skype, Telegram. Together with the service itself, it also comes with a composer and framework to integrate with various Azure services such as Cognitive Services - Language. You can completely do all of this without code! [Learn more][12].

![img](/2021/01/ML.NET-Logo.wine_-1024x683.png)

#### **ML.NET**

If you want to create custom ML models using C# or F# without leaving the ecosystem (say interop with Python or R), ML.NET is a viable option for you. It also allows you to leverage popular libraries such as Infer.NET and TensorFlow. You can also use AutoML for you to build, train, and deploy ML models. [Learn more][13].

Bonus: Outside of ML.NET, F# has been long used for Data Science. There have been a lot of development in this space, like using SciSharrp Stack. [Learn more][14].

![img](/2021/01/ai_builder_logo.png)

#### **AI Builder**

It's a Microsoft Power Platform feature that allows you to build ML models by intuitively connecting to a data source. The approach is very similar of Power BI's dataflows. It uses an intuitive drag-and-drop graphical tool to connect data sources and build an ML model. This is very useful if you want to create simple ML models beyond consuming Cognitive Services APIs. [Learn more][15].

## Integrations

There are hundreds or probably even thousands of way to integrate a form of AI and ML to anything. From the use of RESTful APIs, to adapters, to wrapped libraries, etc. The following are worth mentioning, as these integrations are well established and have a lot of synergy when implementing it.

![img](/2021/01/image-8.png)

#### **SQL Server**

I think even before the hype of "AI/ML" or even "Big Data," a lot of companies have already implemented intelligence or analytics to their data sets in their SQL Server clusters. Particular to ML, SQL server started offering Machine Learning Services since SQL Server 2017. Using the same SQL Server cluster, you can execute Python and R scripts directly to SQL Server. So there are scenarios where use TensorFlow using the database as the direct source for your training model. This approach is very useful if most of your data sources are already aggregated in SQL Server. [Learn more][16].

![img](/2021/01/PowerPlatformIcons-1024x251.png)

#### **Power Platform**

More than what you can do with dataflows in Power BI and AI builder for Power Automate and Power Apps, the Power Platform itself can be in a form serving ML for users. Power BI can integrate with Azure ML & Azure Synapse Analytics, where Power BI focuses on data visualisation. Power Apps can input and output data straight from Azure Cognitive Services. You can automate some internal workflow in Power Automate that integrates with Azure Cognitive Search. The beauty of these approaches is the ease to infuse AI or ML to these services, while the underlying Security and Infrastructure complexities are abstracted or inherited - an example would be Authentication and how easily it is to deploy and consume these apps internally.

Bonus: [Power Virtual Agents][17] is something also worth looking at.

![img](https://user-images.githubusercontent.com/6510026/49263444-6e726180-f3ff-11e8-850e-1024b7af023e.jpeg)

#### **Microsoft 365**

Similar to Power Platform, the suite of Microsoft 365 includes (but not limited to) Excel, PowerPoint, Word, Outlook, Yammer, and Teams. These products and services comes with some really cool "AI-infused" features. In PowerPoint alone, it comes with features like "Design Ideas" and "Presenter Coach". Beyond what's already baked-in and actively being developed by the product teams, creating extensions and infusing a form of AI or ML is also possible. If you think about it, one way or the other, you might also deal with Excel and CSVs in your ML workflow.

![img](/2021/01/image-9.png)

#### **Logic App, Azure Function, and Azure Data Factory**

If you're already in the Microsoft ecosystem, one way or the other you can use LA, AF, or ADF to transfer or ETL (Extract, Transform, Load) from one end to the other. Logic App shines when there are built-in connectors available. Azure Function shine best if you would require a custom coding but want to abstract the underlying infrastructure. Azure Data Factory is best when you want to create custom data pipelines, mostly involving a Data Lake or Synapse.

Links: [Logic Apps][18], [Azure Functions][19], and [Azure Data Factory][20]

![img](https://cdn.cytrack.com/wpv1/dynamics-365-logo-512.png)

#### Dynamics CRM with Customer 360

The last one I want to mention in integration is Dynamics CRM with Customer 360. With the power of Microsoft Graph, you can activate AI-powered insights about your customers. It gives you AI-driven recommendations that will help your business create more data-informed decisions. Let's say someone bought something, you may want to also recommend this item as an added bundle. The innovations of AI in retail are endless!

## Hardware and Infrastructure

Lastly, Azure also offers various infrastructure options in different parts of ML lifecycle. Obviously, you can pretty much spin up an Azure VM to use it for anything, however there are also specific offerings that are specific for ML & AI use-cases.

![img](https://www.meldium.com/2018/11/FpgaServices.png)

#### **FPGA & GPU on Azure VMs**

When training an ML model, it takes a lot of compute power to deal with a large (and complex) data-sets. You have the option to use virtual machines that has FPGA & GPUs, provided you write your script to target those configurations, to train models faster instead of using CPUs. [Learn more][21].

![img](/2021/01/image-10.png)

#### **Azure Containers**

Sometimes, when you want to use your ML model and embed it to your applications, you package it in a Docker container. It's probably the easiest way to make sure you have all the dependencies needed in order to run your model in "inference" mode. Azure provides a lot of options in this space, from:

- **Azure Container Registry** - a general purpose storage of your container images. Very useful if it's versioned well according to your MLOps (Git).
- **Azure Container Instance** (ACI) - this is very lean if you want a standalone or short-lived workloads on your service.
- **Azure App Service for Containers** - similar to ACI, but just uses a different hosting plan underneath. It's useful if you prefer to use an App Service Plan and the model is lean.
- **Azure Kubernetes Services** (AKS) - if you have more complex orchestrations such as various consumer services. This is also the most flexible option (and arguably more complex configuration.)

Bonus: You can also create an advanced ML Training pipeline with AKS such as highly scalable training and inference clusters.

To learn more on how to train a model using a custom Docker image, [click here][22].

![img](/2021/01/image-11.png)

#### **Azure Stack**

There are use-cases where you need to perform AI workloads outside of the cloud. The common example are videos. It's not very ideal to send videos over cloud while you're disconnected or using your on-premises data centre. I believe that Hybrid Cloud is the future and we should not store everything on cloud. I worked on **Azure Stack Edge**, and I'm amazed on the performance that it offers. [Learn more][23].

## **Conclusion**

- Azure ML is a good end-to-end ML workspace.
- You have a lot of options where to use a Jupyter Notebook
- Azure Cognitive Services is the easiest way to start your AI journey.
- There are a lot of options for infrastructure from specialised hardware to containers and edge devices.
- There are myriads of overlaps and synergies with various Azure products or services. You just have to choose which suits you best.

I hope you enjoyed my rundown of all things AI and ML in the Microsoft Cloud. Did I miss anything? Let me know in the comments section.

[1]: https://azure.microsoft.com/en-au/services/machine-learning/
[2]: https://azure.microsoft.com/en-au/services/virtual-machines/data-science-virtual-machines/
[3]: https://docs.microsoft.com/en-gb/azure/notebooks/quickstart-export-jupyter-notebook-project#use-notebooks-in-visual-studio-code
[4]: https://github.com/features/codespaces
[5]: https://docs.microsoft.com/en-us/azure/databricks/applications/machine-learning/
[6]: https://docs.microsoft.com/en-us/azure/hdinsight/r-server/r-server-overview
[7]: https://dotnet.microsoft.com/apps/data/spark
[8]: https://docs.microsoft.com/en-us/azure/synapse-analytics/machine-learning/what-is-machine-learning
[9]: https://docs.microsoft.com/en-us/power-bi/transform-model/desktop-ai-insights
[10]: https://azure.microsoft.com/en-au/services/cognitive-services/#api
[11]: https://azure.microsoft.com/en-au/solutions/knowledge-mining/#overview
[12]: https://azure.microsoft.com/en-gb/services/bot-services/
[13]: https://dotnet.microsoft.com/apps/machinelearning-ai/ml-dotnet
[14]: https://fsharp.org/guides/data-science/
[15]: https://docs.microsoft.com/en-us/ai-builder/overview#:~:text=AI%20Builder%20is%20a%20Microsoft,Power%20Apps%20and%20Power%20Automate.
[16]: https://docs.microsoft.com/en-us/sql/machine-learning/sql-server-machine-learning-services?view=sql-server-ver15
[17]: https://powervirtualagents.microsoft.com/en-us/
[18]: https://docs.microsoft.com/en-us/azure/machine-learning/how-to-trigger-published-pipeline
[19]: https://docs.microsoft.com/en-us/azure/machine-learning/how-to-deploy-functions
[20]: https://docs.microsoft.com/en-us/azure/data-factory/transform-data-machine-learning-service
[21]: https://docs.microsoft.com/en-us/azure/machine-learning/how-to-deploy-fpga-web-service
[22]: https://docs.microsoft.com/en-us/azure/machine-learning/how-to-deploy-custom-docker-image
[23]: https://azure.microsoft.com/en-au/solutions/architecture/ai-at-the-edge/
