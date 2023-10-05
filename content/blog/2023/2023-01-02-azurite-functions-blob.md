---
title: "Debugging Azure Functions Blob Trigger Locally with Azurite"
author: Michael John Peña
draft: false
date: 2023-01-02
image: /2023/01/azurite-functions-blob.png
url: /blog/azurite-functions-blob/
tags:
  - blob
  - functions
  - file
  - azure
---

Debugging Azure Functions locally can be a helpful way to test and troubleshoot your code before deploying it to the cloud. One way to do this is by using a local emulator, such as Azurite, which simulates the Azure storage services in the cloud. In this blog post, we'll walk through how to set up and use Azurite to debug an Azure Functions Blob Trigger locally, using a sample C# function as an example.

## Setting up Azurite

First, you'll need to install and set up Azurite on your local machine. You can do this by running the following command:

```bash
// Using nodejs
npm install -g azurite

// Using docker
docker pull mcr.microsoft.com/azure-storage/azurite
```

This will install the Azurite package globally, allowing you to use it from the command line.

Next, start the Azurite server by running the following command:

```bash
// Using nodejs
azurite

// Using docker
docker run -p 10000:10000 -p 10001:10001 -p 10002:10002 \
    -v c:/azurite:/data mcr.microsoft.com/azure-storage/azurite
```

This will start the Azurite server and create a default storage account with a default blob container. You can customize the configuration of your storage account by using command line arguments, such as `--accountName` and `--blobHost` to specify the name of your storage account and the hostname for the blob endpoint, respectively.

## Debugging a Blob Trigger locally

Now that you have Azurite running on your local machine, you can use it to debug an Azure Functions Blob Trigger. To do this, you'll need to update the connection string for your storage account to point to the local Azurite server.

In your Azure Functions project, open the local.settings.json file and update the connection string for your storage account to the following:

```json
"AzureWebJobsStorage": "UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1:10000"
```

This will tell the Azure Functions runtime to use the local Azurite server when running the function locally.

**Note: I was only able to make it work on ISOLATED process using Rider on my Mac. Double check if it will also work with IN-PROCESS on Windows.**

Next, you'll need to create a blob in the default container of your Azurite storage account. You can do this using the Azure Storage Explorer or by using the Azure Storage SDK for your preferred language.

For this example, let's use Microsoft Azure Storage Explore to drop blob files on to a container.
Download Azure Storage Explorer - [Azure Storage Explorer – cloud storage management | Microsoft Azure](https://azure.microsoft.com/en-us/products/storage/storage-explorer/).

After installation, open the app. Expand on Emulator & Attached and it should automatically connect to your Azurite instance.

Under blob containers, create a `test-samples-trigger` container as we'll use this for testing our Azure functions blob trigger.

![azurite](/2023/01/azure-storage-explorer-azurite1.png)

Now that we have created a blob, we can create an Azure Functions Blob Trigger to execute our code when the blob is added or modified. Here's an example of a Blob Trigger function in C#:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace BlobTrigger.Functions;

public class BlobTriggerFunction
{
    [Function("BlobTriggerFunction")]
    public async Task Run(
        [BlobTrigger("test-samples-trigger/{name}")] string myBlob, string blobTrigger,
        FunctionContext context)
    {
        var logger = context.GetLogger("BlobFunction");
        logger.LogInformation($"C# Blob trigger function Processed blob\n Name:{blobTrigger} ");
    }
}
```

This function is triggered whenever a new or modified blob is added to the "azurite-container" container in the storage account. The function logs the name of the blob and its contents to the Azure Functions logs.

Now that we have our function and blob set up, we can start debugging by running the Azure Functions runtime locally. To do this, open the Azure Functions extension in Visual Studio Code (or Visual Studio/Rider), and click the "Debug" button.

This will start the Azure Functions runtime and attach the debugger to your function. When you add or modify a blob in the `test-samples-trigger` container, your function code will execute and you can use the debugger to troubleshoot any issues.

![azurite](/2023/01/azure-storage-explorer-azurite2.png)

🎉 Congratulations! You can now develop Azure Functions with Blob Trigger locally without the need to create Azure services while doing local development and testing.

## Conclusion

In this blog post, we've covered how to set up and use Azurite to debug an Azure Functions Blob Trigger locally. By using a local emulator like Azurite, you can test and troubleshoot your code before deploying it to the cloud, saving you time and resources. Using the example C# code and Visual Studio Code screenshots provided, you should now be able to set up and debug your own Azure Functions Blob Trigger using Azurite.

Sample code available: [AzureFunctions.Samples/BlobTrigger at main · mjtpena/AzureFunctions.Samples (github.com)](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/BlobTrigger).
