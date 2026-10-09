---
title: "Data-tier Applications (DACPAC) for Azure SQL"
description: "DACPACs provide reliable, repeatable database deployments for enterprise applications."
author: "Michael John Peña"
draft: false
date: 2022-09-28
tags: ["Azure", "SQL Database", "DACPAC", "DevOps"]
---

## Understanding DACPACs

### What is a DACPAC?

A DACPAC (Data-tier Application Component Package) is a single file containing:
- Complete database schema (tables, views, procedures, etc.)
- Pre and post-deployment scripts
- Reference data
- Deployment options

### Extracting a DACPAC

```bash
# Using SqlPackage CLI
SqlPackage /Action:Extract `
    /TargetFile:"MyDatabase.dacpac" `
    /SourceConnectionString:"Server=myserver.database.windows.net;Database=MyDB;User Id=admin;Password=secret"

# With Azure AD authentication
SqlPackage /Action:Extract `
    /TargetFile:"MyDatabase.dacpac" `
    /SourceConnectionString:"Server=myserver.database.windows.net;Database=MyDB;Authentication=Active Directory Interactive"
```

### DACPAC Contents

```xml
<!-- model.xml inside DACPAC (extracted) -->
<?xml version="1.0" encoding="utf-8"?>
<DataSchemaModel>
  <Model>
    <Element Type="SqlTable" Name="[dbo].[Customers]">
      <Property Name="IsAnsiNullsOn" Value="True" />
      <Relationship Name="Columns">
        <Entry>
          <Element Type="SqlSimpleColumn" Name="[dbo].[Customers].[CustomerID]">
            <Property Name="IsNullable" Value="False" />
            <Property Name="IsIdentity" Value="True" />
          </Element>
        </Entry>
        <Entry>
          <Element Type="SqlSimpleColumn" Name="[dbo].[Customers].[CustomerName]">
            <Property Name="IsNullable" Value="False" />
            <Property Name="Length" Value="100" />
          </Element>
        </Entry>
      </Relationship>
    </Element>
  </Model>
</DataSchemaModel>
```

### Publishing a DACPAC

```bash
# Basic publish
SqlPackage /Action:Publish `
    /SourceFile:"MyDatabase.dacpac" `
    /TargetConnectionString:"Server=target-server.database.windows.net;Database=MyDB;User Id=admin;Password=secret"

# Publish with options
SqlPackage /Action:Publish `
    /SourceFile:"MyDatabase.dacpac" `
    /TargetConnectionString:"Server=target-server.database.windows.net;Database=MyDB;..." `
    /p:BlockOnPossibleDataLoss=False `
    /p:DropObjectsNotInSource=False `
    /p:IgnorePermissions=True `
    /p:IgnoreRoleMembership=True `
    /p:ScriptDatabaseOptions=False

# Generate script only (no deployment)
SqlPackage /Action:Script `
    /SourceFile:"MyDatabase.dacpac" `
    /TargetConnectionString:"Server=target-server.database.windows.net;Database=MyDB;..." `
    /OutputPath:"DeployScript.sql"
```

### C# DACPAC Operations

```csharp
using Microsoft.SqlServer.Dac;

public class DacpacService
{
    public void ExtractDacpac(string connectionString, string outputPath, string applicationName)
    {
        var services = new DacServices(connectionString);

        services.Message += (sender, args) =>
        {
            Console.WriteLine(args.Message.Message);
        };

        services.ProgressChanged += (sender, args) =>
        {
            Console.WriteLine($"{args.Status}: {args.Message}");
        };

        var options = new DacExtractOptions
        {
            ExtractApplicationScopedObjectsOnly = true,
            ExtractReferencedServerScopedElements = false,
            VerifyExtraction = true
        };

        services.Extract(outputPath, "MyDatabase", applicationName, new Version(1, 0, 0), options: options);

        Console.WriteLine($"DACPAC extracted to {outputPath}");
    }

    public void PublishDacpac(string dacpacPath, string targetConnectionString)
    {
        var services = new DacServices(targetConnectionString);

        services.Message += (sender, args) =>
        {
            Console.WriteLine(args.Message.Message);
        };

        var options = new DacDeployOptions
        {
            BlockOnPossibleDataLoss = false,
            DropObjectsNotInSource = false,
            IgnorePermissions = true,
            IgnoreRoleMembership = true,
            ScriptDatabaseOptions = false,
            CreateNewDatabase = false,
            IncludeTransactionalScripts = true,
            BackupDatabaseBeforeChanges = true
        };

        using var package = DacPackage.Load(dacpacPath);

        services.Deploy(package, "MyDatabase", true, options);

        Console.WriteLine("DACPAC deployed successfully");
    }

    public string GenerateDeployScript(string dacpacPath, string targetConnectionString)
    {
        var services = new DacServices(targetConnectionString);

        var options = new DacDeployOptions
        {
            BlockOnPossibleDataLoss = false,
            DropObjectsNotInSource = false
        };

        using var package = DacPackage.Load(dacpacPath);

        var script = services.GenerateDeployScript(package, "MyDatabase", options);

        return script;
    }

    public DacpacInfo GetDacpacInfo(string dacpacPath)
    {
        using var package = DacPackage.Load(dacpacPath);

        return new DacpacInfo
        {
            Name = package.Name,
            Version = package.Version,
            Description = package.Description,
            ModelCollation = package.ModelCollation,
            SqlServerVersion = package.SqlServerVersion
        };
    }
}

public class DacpacInfo
{
    public string Name { get; set; }
    public Version Version { get; set; }
    public string Description { get; set; }
    public string ModelCollation { get; set; }
    public string SqlServerVersion { get; set; }
}
```

### Publish Profiles

```xml
<!-- MyDatabase.publish.xml -->
<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="Current" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <IncludeCompositeObjects>True</IncludeCompositeObjects>
    <TargetDatabaseName>MyDatabase</TargetDatabaseName>
    <DeployScriptFileName>MyDatabase.sql</DeployScriptFileName>
    <ProfileVersionNumber>1</ProfileVersionNumber>
    <BlockOnPossibleDataLoss>False</BlockOnPossibleDataLoss>
    <DropObjectsNotInSource>False</DropObjectsNotInSource>
    <IgnorePermissions>True</IgnorePermissions>
    <IgnoreRoleMembership>True</IgnoreRoleMembership>
    <ScriptDatabaseOptions>False</ScriptDatabaseOptions>
    <BackupDatabaseBeforeChanges>True</BackupDatabaseBeforeChanges>
    <VerifyDeployment>True</VerifyDeployment>
    <AllowIncompatiblePlatform>False</AllowIncompatiblePlatform>
    <ExcludeObjectTypes>Users;Logins;RoleMembership;Permissions</ExcludeObjectTypes>
  </PropertyGroup>
  <ItemGroup>
    <SqlCmdVariable Include="Environment">
      <DefaultValue>Development</DefaultValue>
      <Value>$(Environment)</Value>
    </SqlCmdVariable>
  </ItemGroup>
</Project>
```

```bash
# Use publish profile
SqlPackage /Action:Publish `
    /SourceFile:"MyDatabase.dacpac" `
    /TargetConnectionString:"..." `
    /Profile:"MyDatabase.publish.xml"
```

### BACPAC for Data Export

```bash
# Export database to BACPAC (schema + data)
SqlPackage /Action:Export `
    /TargetFile:"MyDatabase.bacpac" `
    /SourceConnectionString:"Server=myserver.database.windows.net;Database=MyDB;..."

# Import BACPAC to new database
SqlPackage /Action:Import `
    /SourceFile:"MyDatabase.bacpac" `
    /TargetConnectionString:"Server=target-server.database.windows.net;Database=NewDB;..."
```

### CI/CD Pipeline Integration

```yaml
# Azure DevOps pipeline
stages:
  - stage: Build
    jobs:
      - job: BuildDacpac
        pool:
          vmImage: 'windows-latest'
        steps:
          - task: VSBuild@1
            inputs:
              solution: '**/*.sqlproj'
              configuration: 'Release'

          - task: PublishBuildArtifacts@1
            inputs:
              pathToPublish: '$(Build.SourcesDirectory)/**/bin/Release/*.dacpac'
              artifactName: 'dacpac'

  - stage: DeployToTest
    dependsOn: Build
    jobs:
      - deployment: DeployDatabase
        environment: 'test'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: SqlAzureDacpacDeployment@1
                  inputs:
                    azureSubscription: 'AzureConnection'
                    ServerName: 'test-server.database.windows.net'
                    DatabaseName: 'MyDatabase'
                    SqlUsername: '$(DbUser)'
                    SqlPassword: '$(DbPassword)'
                    DacpacFile: '$(Pipeline.Workspace)/dacpac/**/*.dacpac'
                    PublishProfile: '$(Pipeline.Workspace)/dacpac/**/*.publish.xml'
```

## Best Practices

1. **Version your DACPACs** - Include version in build process
2. **Use publish profiles** - Standardize deployment options
3. **Test deployments** - Always test in non-production first
4. **Backup before deploy** - Enable backup option
5. **Review scripts** - Generate and review before applying

DACPACs provide reliable, repeatable database deployments for enterprise applications.
