---
title: "Create a File Converter Service in 5 minutes or less using Gotenberg and Azure Container Instances"
author: MJ Peña
draft: false
date: 2022-12-23
image: /2022/12/gotenberg-aci.png
url: /blog/gotenberg-aci/
tags:
  - api
  - file
  - azure
---

I'm very surprised that there isn't a straight forward library out there that is free to use and convenient in terms of file conversion. I think it's because a lot of these file formats come with proprietary software, specially during the early day: Office by Microsoft, PDF by Adobe, etc. Good thing there is Gotenberg!

Gotenberg is an open-source tool that allows you to convert HTML, Markdown, and Office documents to PDF by sending HTTP requests to a server. It is especially useful if you have a web application that needs to generate PDF documents on the fly. In this tutorial, we will show you how to deploy Gotenberg using Azure Container Instances (ACI), a fully managed container hosting service provided by Microsoft Azure.

## Prerequisites

Before we get started, you will need the following:

- An Azure account. If you don't have one, you can sign up for a free trial at [azure.com](https://azure.com/).
- The Azure CLI, which is a command-line tool that you can use to manage Azure resources. You can install it by following the instructions [here](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest). I personally prefer to run Azure Cloud shell straight from the Azure portal so that all authentication part is already sorted.

You also need to create a resource group as part of this tutorial:

```bash
az group create --location westus --resource-group MyResourceGroup
```

## Step 1: Create a container group

A container group is a logical host for one or more containers that are deployed together on the same virtual machine or host. To create a container group, use the following command:

`az container create --name my-container-group --image gotenberg/gotenberg:latest --resource-group MyResourceGroup --ports 3000 --dns-name-label contoso --ip-address public`

Replace `my-container-group` with a unique name for your container group. This command will create a container group with a single container running the latest version of the Gotenberg server image. The container will listen on port 3000 for incoming HTTP requests.

## Step 2: Expose the container group to the internet

By default, the container group is not accessible from the internet. To expose it, we need to create a public IP address and attach it to the container group. Use the following command to do that:

```bash
az container create --name my-container-group --image gotenberg/gotenberg:latest --resource-group MyResourceGroup --ports 3000 --dns-name-label contoso --ip-address public
```

Note that it's also recommended to have a DNS label as the IP Address is not reserved.

## Step 3: Test the deployment

To test the deployment, send an HTTP request to the container group's FQDN using the Gotenberg API. For example, you can use the following cURL command to convert a simple local document file (docx) to PDF:

```bash
curl --request POST \
    --url contoso.westus.azurecontainer.io:3000 \
    --request POST 'http://localhost:3000/forms/libreoffice/convert' \
    --header 'Content-Type: multipart/form-data' \
    --form files=@'mydocument.docx' \
    > result.pdf
```

Replace `contoso.westus.azurecontainer.io` with the actual FQDN (fully qualified domain name) of your container group. If everything is working correctly, you should receive a PDF file as a response.

## Conclusion

In this tutorial, we showed you how to deploy Gotenberg using Azure Container Instances. With this setup, you can easily generate PDF documents from HTML, Markdown, and Office documents by sending HTTP requests to the Gotenberg server. To learn more, visit the [ Gotenberg](https://gotenberg.dev/) site.
