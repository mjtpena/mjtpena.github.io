---
title: Synology NAS Series – Cloud Sync with Azure Storage
author: Michael John Peña
draft: false
date: 2020-09-28
url: /blog/synology-nas-series-cloud-sync-with-azure-storage/
images: 
     - /2020/09/20200821_025202969_iOS-940x510.jpg
tags:
  - Technology
tags:
  - azure
  - cloud
  - nas
  - storage
---

# Foreword

Synology reached out to me to give their new <a href="https://www.synology.com/en-us/products/DS920+" target="_blank" rel="noreferrer noopener">DiskStation&nbsp;DS920+</a> a review. If you're not yet aware of Synology, they are the leading NAS (Network-attached storage) provider for home and work use-cases. You can use a NAS for pretty much anything such as backing up files, sharing files in a local network, streaming media files, or have your own "private cloud".

Throughout the years, the concept of NAS has developed and there is now a very thin line between doing things locally in your network and storage capabilities of cloud vendors.

I am creating a Synology NAS series on highlighting the different capabilities of their NAS. In particular, the features that work within the Microsoft ecosystem such as Microsoft Azure, Azure Active Directory, and Microsoft 365, which is something I use on a day-to-day basis.

# Introduction

Lately I've been working on a lot of live video analytics to analyse CCTV (surveillance) feeds and extract useful information around it. There are 3 major points around my customer's business requirements and policy.

1. The video analytics processing should happen in an "edge" environment. The stream should not send data constantly to the public cloud in real-time, where "the magic" is happening in the cloud. This whole environment including the "AI/ML" models should run through a local server.
2. We archive CCTV feeds in the public cloud through a reliable and cost-effective public storage mechanism. There is no requirement for these videos to be accessible in real-time.
3. The customer wants that network traffic should not clog or would require dedicated network connections for video processing and archiving. They leverage the same network infrastructure in their remote office locations.

# Why Cloud Sync + Azure Storage?

In this specific business case, the customer already uses Synology for NAS and an active Azure subscription.

One thing you might think of is, why don't I just use my personal OneDrive or Dropbox to do this? Well, the answer is that Enterprise customers usually have massive files. In particular, this customer has around 100+ cameras surveying 24/7. Using something of a personal subscription is not cost effective.

The video files are around 2 Terabytes per day and for archiving purposes only. Example is when there are incidents that require manual investigation.

Azure Blob storage is the perfect fit for this as it has: hot, cool, and archive access tiers. Learn more <a rel="noreferrer noopener" href="https://docs.microsoft.com/en-gb/azure/storage/blobs/storage-blob-storage-tiers?tabs=azure-portal" target="_blank">here</a>.

Cloud Sync can also schedule upload times to avoid disrupting the network during office hours.

# Getting Started

Setting up Cloud Sync is fairly easy and a straightforward process. To get started, go to your Synology NAS landing page. Then go to "Package Center" to search, install, and open Cloud Sync.<figure class="wp-block-image size-large">

![img](/2020/09/Package-Center-1024x558.png)

## Choose a Cloud Provider

After opening Cloud Sync, it will prompt you to choose a cloud provider. Choose Azure storage.

## Optional: Create an Azure storage

If you don't have an existing Azure Storage or wish to create a new one, then follow the steps below.

In the Azure portal, search for "Storage" and create a new instance.

Note: You can customize other parameters here, such as Access Tier (Cool / Hot) and Performance (Standard / Premium).

Finish the wizard and create the resource.

## Optional: Create a Blob Container

If you already have a blob container, skip to the next section. In your Azure storage, navigate to the Blob Service section of the main blade and click on Containers.

![img](/2020/09/image-1.png)

Create a container by clicking on the "+ Container" button. Assign a name and access to it.

Note: For this specific exercise, the access level would not matter.

![img](/2020/09/image-2-1024x492.png)

## Retrieve the Storage Key

We need a storage key to establish a secure connection between Cloud Sync and the Azure storage.

To do this, go to the Azure Portal and navigate to the Azure storage that you want Cloud Sync to point to.

In the Settings section of the main blade of the storage account, go to "Access Keys".

Copy the value of either key1 or key2. Make sure you don't share these keys to other people who don't need it, nor save it to a location that others can easily access like a text file.

## Cloud Sync - establish connection

Go back to the Cloud Sync wizard and fill in the details below:

- **Service endpoint**: Azure Global (or China)
- **Storage account**: name of the Azure storage without prefixes and suffixes. Note that all storage account names are unique.
- **Access key**: Paste in the key mentioned above.
- **Blob container name**: The Blob container where you want to upload the files.

Click on Next.

## Choose the folder(s) you want to Sync

In the task setting, Select which folder(s) you want to sync. I recommend that you merge the files in a folder specific for archiving.

## Choose Sync Direction

You have the option to set the sync direction of your files. In most cases it is ideal to set it to Bidirectional, so that when a system fails, you still have other options to back-up and recover files.

## Set schedule settings

This is an outstanding feature of Cloud Sync. With this customer, we don't want to upload the Terabytes of data during office hours. We only set it during off hours and weekends.

Set the time of days you want syncing to run and suspended.

## Optional: Encrypt Data

There is an optional setting to encrypt data. This will allow the files to be encrypted in transit and when in storage. The downside of doing this approach is that only Cloud Sync can recognize the data that were uploaded.

## Complete the Wizard

Click on Next and finish the wizard. A pop-up should appear, confirming a successful setup.

Once the connection to the Azure storage is established, you will see the notifications saying files are being synced.

# Conclusion

To my interest, I've also adapted this pattern with my personal/home surveillance system.

One thing I would say is that - it just works - which is good. I think it's seldom to see managed services or platform these days where the burden of over configuration is in the hands of the customer.

I've been running this setup for a few weeks now and I am very delighted with the results. The setup is very easy that doesn't require deep technical skills in file storage. I remember the days when doing this would require complex scripts to sync between network files and centralized servers. Those days are now a thing of a past.
