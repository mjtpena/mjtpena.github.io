---
title: The Hybrid Cloud Journey with Microsoft Azure
author: MJ Peña
draft: false
date: 2021-08-28T02:19:19Z
url: /blog/hybrid-cloud/
images: 
     - /2021/08/AzureHybrid-featured.png
tags:
  - Azure
  - Hybrid Cloud
  - Edge
  - Technology
  - IoT
  - Infrastructure
---
Hybrid cloud is the trend right now I see in a lot of companies and enterprises. The term hybrid has grown too in the last couple of years. It used to be just the connectivity between an on-premises data center to public clouds like AWS and Azure. This time, hybrid now also includes multi-cloud and edge computing. It's about borderless connectivity across different topologies or deployment models happening around. 

## Why hybrid cloud?

To answer the most important question: Why hybrid cloud? The answer is really simple, **not all apps and data should be on 1 public cloud**. 

To give you a better understanding of how it will all make sense, let's travel back in time around 2011 / 2012 when public cloud like AWS and Azure are just getting mainstream adoption.

## On-Premise Infrastructure

![](/2021/08/AzureHybrid-Onprem.png)

A lot of companies, especially big enterprise ones in the past, have physical racks of servers. The company owns the hardware and comes with high capital to set up their IT infrastructure and operations. We're talking about hundreds of thousands (even millions) of dollars of capital and operations expense in order to have robust databases and applications. Companies have dedicated System Operations team that are not fully embedded with developers. DevOps and infrastructure as a code are not yet a thing. Developers are really just coding, it is someone else' problem to package it and make sure it runs on servers.

Then public cloud happened. Some startups could start natively on cloud without the baggage of legacy infrastructure. When the dawn of AWS and Azure came along, a lot of these companies weren't able to just "lift and shift" to the public cloud.They adopted a "hybrid" approach like most critical workloads are still on-premise and some are deployed in public cloud. The common pattern was putting the public facing web application on a public cloud to cater the elastic scale while the crucial and sensitive data still lives on-premises.

## Azure Virtualization

![](/2021/08/AzureHybrid-Virtualization.png)

Virtualization is a key component of both public cloud and hybrid cloud. This technology allowed companies to spin up multiple virtual machines, but the resource allocation would only take minutes instead of days or months because of the physical procurement of the device. Even before public cloud became popular, big enterprise companies already adopt a virtualize environment to manage their high performance servers. **Hyper-V** is one of the biggest player in this space, specially when you are working on a Windows Server and SQL Server environment. With Hyper-V, you can create virtual machines on the fly using your servers. That is why, when big enterprises moved to Azure, most of the approaches and underlying infrastructure are also leveraged. Automation scripts written in PowerShell were also re-purposed for public cloud.

In order to bridge this gap for enterprises to adopt hybrid, the common approach is to use a **VPN (Virtual Private Network)**. The technology is not new, as this is also the same approach companies used when performing multi-region operations across their data centres. This time, it's just another point-to-point connectivity from one infrastructure to the public cloud. This private connection allows you to expose specific data, application, and ports of your on-premise infrastructure securely to the public cloud without them being accessible to the public internet. Microsoft Azure offers this type of service with **VPN Gateway**.

Microsoft Azure also offers a premium service called **Express Route** that allows you to set up a dedicated network connection between your data centre and an Azure data centre for faster and more stable latency. Then inside your Azure resources, you can establish secured networks using **Azure Virtual Networks** so that only specific resources are bound to communicate with each other. Not because a resource is in "public cloud", it can be accessed by everyone using the public network. The very early use cases of these were protecting database servers to ensure that only application servers can communicate to it. Since then, the networking components paradigm and policies of Azure have developed.

## Azure Containers

![](/2021/08/AzureHybrid-Containers.png)

The virtualization space has been disrupted these past few years because of containers (Docker) and Kubernetes. Unlike Virtual Machines, where you have an "image" (often enormous) that you can deploy and virtualize across your hypervisor (like Hyper-V) or like **Azure VM Scalesets**. This time around, you can package your application and "just" all the underlying application dependencies as a container. You will now then be able to run this container to an orchestrator where the underlying infrastructure mechanisms such as networking and elasticity (scaling) are easily managed - such as Kubernetes. Think of a more traditional .NET app on IIS and .NET runtime on Windows Server can now easily be packaged into a container deployed to Kubernetes straight away without having IIS Configuration Manager.

Microsoft Azure offers a lot in this space. Without detailing, these are the primary services that you can use:
- **Azure Kubernetes Services**: managed Kubernetes orchestrator.
- **Azure Container Instances**: deploy a container in a running instance straight away.
- **Azure Container Registries**: general purpose storage of containers.
- **App Services for Containers**: similar to ACI, but leverages App Service Plan.

How this relates to Hybrid are: 

- It's relatively easier to migrate (or co-deploy) a container from one orchestrator service to another. I'm not saying it's going to work on day 1, but the transition and compatibility are easier. A container from one managed Kubernetes cluster can easily be deployed to an on-premise Kubernetes cluster and vice versa.

- You do more abstraction on the underlying infrastructure and platform, and focus on your application. In the future, most of these would probably just be toggle buttons or configuration settings that you can enable and disable. 

- Scaling infrastructure has always been a trivial thing to do. There is no easy way to scale applications. Of course, you can always just "beef-up" the servers and buy more resources. However, other than costs, you also have to consider the maintainability and reliability of the services. Containers made it relatively "more" manageable.

## Multi-cloud

![](/2021/08/AzureHybrid-Multi-Cloud.png)

As the race in public cloud continues, these companies are becoming much more competitive with the services that are available and the pricing model that they offer. Although in my honest opinion it's hard to beat these public clouds in terms of service reliability like (99.999% and 99.99%), they still experience outage from time to time. This brings to the concept of **"Cloud Gravity"**. Cloud Gravity is when you build apps and services on top of a specific cloud provider, you then become more glued to the infrastructure that moving to a different provider is not very seamless. This comes with technology fatigue when, instead of focusing on the business requirements and application logic, you become tied in to what the public cloud service offers. The developers and infrastructure engineer have to learn things that are just specific for that vendor.

That is why the emergence of a multi-cloud strategy came to be. Some companies don't bet on just one cloud provider, they utilise multiple cloud providers on various operations and workloads. Some common observations I had in the past are having AWS for public facing apps, Azure for enterprise apps, data warehousing & analytics, and Active Directory / Office 365 integrations; and Google Cloud for AI & Machine Learning. Obviously, most of the services offered by these providers have parallels and often have a lot of overlaps. 

However, setting up for a multi-cloud strategy is complex and requires a lot of resources. Teams need to be up-skilled in various technologies and platforms. The account relationship between vendors is also something to consider. As the services and platforms of these public clouds are also moving at a rapid pace, that also means your teams should be able to sustain that pace.

## Edge Infrastructure

![](/2021/08/AzureHybrid-Edge.png)

In recent years, there is an increased adoption of edge devices. I know this for a fact, because this has been what I've been working on for at least 2 years now. With the rise of Machine Learning and IoT, the need for centralized infrastructure (public cloud and on-premise data centre) is becoming more prevalent. One of the common use cases that I worked on is with Video Analytics. You have a stream of video files across your CCTV and IP Cameras. You shouldn't transmit all of those video feeds to the public cloud because it's expensive and slow (at least for now). The idea approach is to have a server that is good enough to process the streaming and the ML models to do inferences. The telemetries from that inference (like object detection) would then be sent to the public cloud, such as an **Azure IoT Hub**.

There are a lot of activities happening here, from the public cloud providers like (Azure, AWS, Google) to a bunch of IoTs device manufactures. Some are more managed wherein the device sends data to the provider, and you just consume an API, some are bare metals where you can choose what can be in it. Microsoft Azure offers a lot in this IoT and Compute on Edge space:

### Azure on Edge - High Compute

![](/2021/08/AzureHybrid-EdgeHigh.png)

- **Azure Stack HCI**: a standalone Azure on your premises.
- **Azure Stack Hub**: on-premises extensions of Azure public cloud.
- **Azure Stack Edge**: acts as storage and gateway to Azure.

### Azure on Edge - Portable

![](/2021/08/AzureHybrid-EdgeLow.png)

- **Azure Percept**: full stack platform to cover AI on edge. This is good for prototyping your machine learning and computer visions in a fully managed package.
- **Azure Sphere**: secured platform with built-in security features for internet-connected devices. This is not a device that Microsoft produces, but a standard that chip manufacturers can adopt to make sure that when devices connect to the internet, they are secured.
- 3rd party IoT devices like Arduino suites can also connect to Azure through IoT Hub and installing the IoT Edge runtime on to it. 

As you have more infrastructure and connected devices in place, it gets more complicated to manage. Good thing is that a lot of these edge servers now also support an orchestrator like Kubernetes in order to manage application containers easily. If you're operating in a low connectivity environment such as ship vessels, mining sites, airplanes, you can now leverage technologies such as managed applications and databases that are enclave and within the perimeter of that environment. As well as useful telemetries and semi-structured data can seamlessly be transmitted over the public cloud, where the more complex and high-intensity computations can be processed. It is indeed revolutionizing the traditional "embedded" software on hardware into a more intelligent hardware infrastructure.

## Azure Arc

![](/2021/08/AzureArc.png)

In the future (and today), what companies will end up is having multiple diverse infrastructure in place such as virtual machines on public cloud, virtual machines on-premise data centres, edge infrastructure, managed Kubernetes on public cloud, and managed services across places. You'll have public facing applications on public cloud, some regional data centres for data warehousing, edge infrastructure on remote offices and operations, and a bunch of connected IoT devices. Now how are you going to manage the policies across all of them? That's where a service like Microsoft Arc comes in to place.

Microsoft Arc allows you to have a single pane of glass for monitoring all of your resources wherever they are sitting. You can leverage policies and standards that you've already set up for your Azure resources, this time extending them to non-Azure (public cloud) resources. Azure also allows you to implement RBAC (Role Based Access Controls) to govern who have access to which resources. Probably the best reason to use Azure Arc is the ability to enable connectivity across various resources. Think of it in the future where you don't have to manage the underlying infrastructure to connect disparate resources and they will just be connected under the hood. Currently, Microsoft Arc supports servers, Kubernetes, and soon Managed Services (SQL, Serverless, etc).

![](/2021/08/AzurePortal-arc.png)

Hybrid cloud and Edge are the things that I'm really into right now. This will be my focus for the next few years to come.

# Summary

Microsoft Azure allows you to have a flexibility of your infrastructure:

- On-premises
- Multi-Cloud
- Edge

Many companies are now adopting a multi-cloud strategy.

Edge infrastructure allows you to run remote operations with high performance hardware.

Azure arc allows you to centralize the management of your hybrid infrastructure.

# Resources

- [What is Hybrid Cloud?](https://azure.microsoft.com/en-gb/overview/what-is-hybrid-cloud-computing/)
- [Multicloud and hybrid cloud solutions | Microsoft Azure](https://azure.microsoft.com/en-au/solutions/hybrid-cloud-app/#overview)
- [Azure Hybrid Benefit – hybrid cloud | Microsoft Azure](https://azure.microsoft.com/en-au/pricing/hybrid-benefit/)
