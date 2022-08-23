---
title: "Backup Azure SQL Database using Azure Data Studio on your Desktop"
author: MJ Peña
draft: false
date: 2022-08-22
url: /blog/azuresql-datastudio/
tags:
  - SQL Azure
  - Azure Data Studio
---

## Doing it via the Portal

I'm trying to backup our SQL Azure database, and to my surprise, it doesn't seem to be "straight forward". Officially, you have to do it via the Azure portal (or Azure CLI), but I find the process a bit overwhelming for simple backup of "I just want the file". 

If you do it via the portal, you have to go to the Database instance, and click on Export.
![](static/2022/08/20220823070905.png)

Then fill up the destination value.
![](static/2022/08/20220823071017.png)

Wait for the process to finish, and then download the file on that Azure storage. I personally think this is the preferred approach when the database file is very big that it doesn't make sense to download locally.

On some cases, you just need a copy of the database, so that either developers can interface and make APIs faster on their local machines. 


## Doing it via Azure Data Studio

I looked both [[Azure Data Studio]] and [[SQL Server Management Studio (SSMS)]] but to my surprise, Azure SQL backup doesn't work just like how you do it on local DB (docker/sql express) as well as on-premises databases. 

Good thing, there is this [SQL Server dacpac extension](https://docs.microsoft.com/en-us/sql/azure-data-studio/extensions/sql-server-dacpac-extension?view=sql-server-ver15). This gives you other import/export functionalities that are supported to almost any version of SQL databases that supports BACPAC.

After installing the extension, right click on the Azure SQL Database that you want to export and select "Data-tier Application Wizard":

![](static/2022/08/20220823071629.png)

Select the 4th option (Export both schema and data as .bacpac)
![](static/2022/08/20220823071714.png)

Complete the wizard (choose file location) and confirm.

It will then download a bacpac of your Azure SQL Database!
![](static/2022/08/20220823071806.png)

## Doing it via SQL Server Management Studio (SSMS)

Connect to the Azure SQL database via SSMS.

Right click on the database and select "Generate Scripts..."
![](static/2022/08/20220823080654.png)

Choose the objects that you want.
![](static/2022/08/20220823080908.png)

Select the scripting options. If you want to include the data, go to "Advanced"
![](static/2022/08/20220823080938.png)

On the types of data to script, choose "Schema and Data"
![](static/2022/08/20220823081003.png)

It will then create a SQL script of your database.

The good thing about this approach is that you can modify the script in case you have other features that are only applicable to certain SQL type such as Ledger capabilities.

This is not recommended if your database is huge and contains a lot of data. 