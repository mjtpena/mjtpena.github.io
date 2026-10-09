---
title: "Database Projects in Azure Data Studio"
description: "Database Projects bring modern DevOps practices to database development."
author: "Michael John Peña"
draft: false
date: 2022-09-26
tags: ["Azure", "Azure Data Studio", "Database Projects", "DevOps"]
---

## Getting Started with Database Projects

### Creating a New Project

```bash
# Install SQL Database Projects extension first
# Extensions > Search "SQL Database Projects"

# Create project via Command Palette
# Ctrl+Shift+P > "Database Projects: New Project"
```

### Project Structure

```text
MyDatabaseProject/
├── dbo/
│   ├── Tables/
│   │   ├── Customers.sql
│   │   ├── Orders.sql
│   │   └── Products.sql
│   ├── Views/
│   │   └── vw_OrderSummary.sql
│   ├── StoredProcedures/
│   │   ├── sp_CreateOrder.sql
│   │   └── sp_GetCustomerOrders.sql
│   └── Functions/
│       └── fn_CalculateOrderTotal.sql
├── Security/
│   ├── Schemas/
│   │   └── sales.sql
│   └── Roles/
│       └── SalesRole.sql
├── Scripts/
│   ├── PostDeployment/
│   │   └── SeedData.sql
│   └── PreDeployment/
│       └── ValidateVersion.sql
├── MyDatabaseProject.sqlproj
└── README.md
```

### Table Definition

```sql
-- dbo/Tables/Customers.sql
CREATE TABLE [dbo].[Customers]
(
    [CustomerID] INT IDENTITY(1,1) NOT NULL,
    [CustomerName] NVARCHAR(100) NOT NULL,
    [Email] NVARCHAR(256) NOT NULL,
    [Phone] NVARCHAR(20) NULL,
    [Address] NVARCHAR(500) NULL,
    [City] NVARCHAR(100) NULL,
    [Country] NVARCHAR(100) NULL,
    [CreatedDate] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    [ModifiedDate] DATETIME2 NULL,
    CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED ([CustomerID]),
    CONSTRAINT [UQ_Customers_Email] UNIQUE ([Email])
);
GO

CREATE INDEX [IX_Customers_Email] ON [dbo].[Customers]([Email]);
GO

CREATE INDEX [IX_Customers_Country] ON [dbo].[Customers]([Country]);
GO
```

### Stored Procedure Definition

```sql
-- dbo/StoredProcedures/sp_CreateOrder.sql
CREATE PROCEDURE [dbo].[sp_CreateOrder]
    @CustomerID INT,
    @OrderItems dbo.OrderItemType READONLY,
    @OrderID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    BEGIN TRY
        -- Create order header
        INSERT INTO dbo.Orders (CustomerID, OrderDate, Status)
        VALUES (@CustomerID, GETUTCDATE(), 'Pending');

        SET @OrderID = SCOPE_IDENTITY();

        -- Insert order items
        INSERT INTO dbo.OrderDetails (OrderID, ProductID, Quantity, UnitPrice)
        SELECT
            @OrderID,
            ProductID,
            Quantity,
            UnitPrice
        FROM @OrderItems;

        -- Update order total
        UPDATE dbo.Orders
        SET TotalAmount = (
            SELECT SUM(Quantity * UnitPrice)
            FROM dbo.OrderDetails
            WHERE OrderID = @OrderID
        )
        WHERE OrderID = @OrderID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
```

### Pre and Post Deployment Scripts

```sql
-- Scripts/PreDeployment/ValidateVersion.sql
:setvar DatabaseVersion "2.0.0"

PRINT 'Deploying version $(DatabaseVersion)';

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE VersionNumber = '1.0.0')
BEGIN
    RAISERROR('Version 1.0.0 must be deployed first', 16, 1);
END
GO
```

```sql
-- Scripts/PostDeployment/SeedData.sql
PRINT 'Running post-deployment seed data script';

-- Insert reference data
IF NOT EXISTS (SELECT 1 FROM dbo.OrderStatuses WHERE StatusCode = 'PENDING')
BEGIN
    INSERT INTO dbo.OrderStatuses (StatusCode, StatusName, Description)
    VALUES
        ('PENDING', 'Pending', 'Order is awaiting processing'),
        ('PROCESSING', 'Processing', 'Order is being processed'),
        ('SHIPPED', 'Shipped', 'Order has been shipped'),
        ('DELIVERED', 'Delivered', 'Order has been delivered'),
        ('CANCELLED', 'Cancelled', 'Order was cancelled');
END

-- Update version tracking
MERGE INTO dbo.SchemaVersions AS target
USING (SELECT '$(DatabaseVersion)' AS VersionNumber, GETUTCDATE() AS DeployedDate) AS source
ON target.VersionNumber = source.VersionNumber
WHEN NOT MATCHED THEN
    INSERT (VersionNumber, DeployedDate)
    VALUES (source.VersionNumber, source.DeployedDate);
GO
```

### Project File Configuration

```xml
<!-- MyDatabaseProject.sqlproj -->
<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build">
  <Sdk Name="Microsoft.Build.Sql" Version="0.1.9-preview" />
  <PropertyGroup>
    <Name>MyDatabaseProject</Name>
    <DSP>Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider</DSP>
    <ModelCollation>1033, CI</ModelCollation>
    <TargetDatabaseSet>True</TargetDatabaseSet>
    <DefaultCollation>SQL_Latin1_General_CP1_CI_AS</DefaultCollation>
    <PreDeployScript>Scripts\PreDeployment\ValidateVersion.sql</PreDeployScript>
    <PostDeployScript>Scripts\PostDeployment\SeedData.sql</PostDeployScript>
  </PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)' == 'Release'">
    <OutputPath>bin\Release\</OutputPath>
    <TreatWarningsAsErrors>True</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <Build Include="dbo\Tables\Customers.sql" />
    <Build Include="dbo\Tables\Orders.sql" />
    <Build Include="dbo\StoredProcedures\sp_CreateOrder.sql" />
    <None Include="Scripts\PreDeployment\ValidateVersion.sql" />
    <None Include="Scripts\PostDeployment\SeedData.sql" />
  </ItemGroup>
  <ItemGroup>
    <ArtifactReference Include="$(SystemDacpacPath)\master.dacpac">
      <HintPath>$(SystemDacpacPath)\master.dacpac</HintPath>
      <SuppressMissingDependenciesErrors>False</SuppressMissingDependenciesErrors>
    </ArtifactReference>
  </ItemGroup>
</Project>
```

### Building and Publishing

```bash
# Build project
dotnet build MyDatabaseProject.sqlproj

# Build with specific configuration
dotnet build MyDatabaseProject.sqlproj -c Release

# Generate DACPAC
# Output: bin/Release/MyDatabaseProject.dacpac
```

```powershell
# Publish using SqlPackage
SqlPackage /Action:Publish `
    /SourceFile:"bin/Release/MyDatabaseProject.dacpac" `
    /TargetConnectionString:"Server=myserver.database.windows.net;Database=MyDatabase;User Id=admin;Password=secret" `
    /p:BlockOnPossibleDataLoss=False `
    /p:DropObjectsNotInSource=False

# Generate script only
SqlPackage /Action:Script `
    /SourceFile:"bin/Release/MyDatabaseProject.dacpac" `
    /TargetConnectionString:"Server=myserver.database.windows.net;Database=MyDatabase;..." `
    /OutputPath:"deployment.sql"
```

### CI/CD Pipeline Integration

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

variables:
  buildConfiguration: 'Release'
  dacpacPath: '$(Build.ArtifactStagingDirectory)/dacpac'

stages:
  - stage: Build
    jobs:
      - job: BuildDatabase
        steps:
          - task: UseDotNet@2
            inputs:
              version: '6.0.x'

          - task: DotNetCoreCLI@2
            displayName: 'Build Database Project'
            inputs:
              command: 'build'
              projects: '**/*.sqlproj'
              arguments: '-c $(buildConfiguration)'

          - task: CopyFiles@2
            displayName: 'Copy DACPAC'
            inputs:
              SourceFolder: '$(Build.SourcesDirectory)'
              Contents: '**/*.dacpac'
              TargetFolder: '$(dacpacPath)'

          - task: PublishBuildArtifacts@1
            inputs:
              PathtoPublish: '$(dacpacPath)'
              ArtifactName: 'database'

  - stage: DeployDev
    dependsOn: Build
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/develop'))
    jobs:
      - deployment: DeployToDevDatabase
        environment: 'dev-database'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: SqlAzureDacpacDeployment@1
                  inputs:
                    azureSubscription: 'AzureServiceConnection'
                    ServerName: 'dev-server.database.windows.net'
                    DatabaseName: 'MyDatabase'
                    SqlUsername: '$(DbUser)'
                    SqlPassword: '$(DbPassword)'
                    DacpacFile: '$(Pipeline.Workspace)/database/**/*.dacpac'
```

## Best Practices

1. **Version everything** - Treat database as code
2. **Use meaningful naming** - Follow consistent conventions
3. **Include pre/post scripts** - Handle data migrations
4. **Test before deploy** - Build validation catches errors
5. **Automate deployments** - Use CI/CD pipelines

Database Projects bring modern DevOps practices to database development.
