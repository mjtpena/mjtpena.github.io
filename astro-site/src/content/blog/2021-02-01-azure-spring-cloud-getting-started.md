---
title: Getting Started with Azure Spring Cloud for Java Microservices
author: Michael John Peña
draft: false
date: 2021-02-01
url: /blog/azure-spring-cloud-getting-started/
tags:
  - Azure
  - Spring Cloud
  - Java
  - Microservices
  - Cloud Native

---

I wrote "2021-02-01-azure-spring-cloud-getting-started" to share practical, production-minded guidance on this topic.

## Why Azure Spring Cloud?

If you're running Spring Boot applications, you've probably dealt with the complexity of setting up Kubernetes clusters, configuring service meshes, and managing infrastructure. Azure Spring Cloud abstracts all of this complexity away while still giving you enterprise-grade features.

Key benefits include:

- **Fully managed Spring runtime** - No need to manage underlying VMs or Kubernetes
- **Built-in service discovery** - Eureka server managed for you
- **Config server integration** - Centralized configuration management with Git
- **Blue-green deployments** - Zero-downtime deployments out of the box
- **Integrated monitoring** - Application Insights integration for distributed tracing

## Prerequisites

Before we dive in, make sure you have:

- Azure CLI installed
- Java 11 or later
- Maven 3.5+
- An Azure subscription

## Creating an Azure Spring Cloud Instance

First, let's install the Azure Spring Cloud extension and create an instance:

```bash
# Install the Azure Spring Cloud extension
az extension add --name spring-cloud

# Create a resource group
az group create --name rg-springcloud-demo --location eastus

# Create an Azure Spring Cloud instance
az spring-cloud create \
    --name my-spring-cloud \
    --resource-group rg-springcloud-demo \
    --location eastus \
    --sku Standard
```

The creation process takes about 5-10 minutes. The Standard tier includes features like VNet injection and auto-scaling.

## Creating a Simple Spring Boot Application

Let's create a simple REST API using Spring Boot. Start with your `pom.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.4.2</version>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>demo-service</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>demo-service</name>

    <properties>
        <java.version>11</java.version>
        <spring-cloud.version>2020.0.0</spring-cloud.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>com.microsoft.azure</groupId>
            <artifactId>spring-cloud-starter-azure-spring-cloud-client</artifactId>
            <version>2.4.0</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

Now create your main application class:

```java
package com.example.demoservice;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.*;

@SpringBootApplication
@RestController
public class DemoServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoServiceApplication.class, args);
    }

    @GetMapping("/hello")
    public String hello(@RequestParam(defaultValue = "World") String name) {
        return String.format("Hello, %s! Welcome to Azure Spring Cloud.", name);
    }

    @GetMapping("/health")
    public String health() {
        return "Service is healthy!";
    }
}
```

## Deploying to Azure Spring Cloud

Build your application and deploy it:

```bash
# Build the application
mvn clean package -DskipTests

# Create an app in Azure Spring Cloud
az spring-cloud app create \
    --name demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud \
    --assign-endpoint true

# Deploy the JAR file
az spring-cloud app deploy \
    --name demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud \
    --jar-path target/demo-service-0.0.1-SNAPSHOT.jar
```

The `--assign-endpoint true` flag creates a public endpoint for your service.

## Setting Up Config Server

One of the powerful features of Azure Spring Cloud is the integrated Config Server. Create a Git repository with your configuration files:

```yaml
# application.yml in your config repo
spring:
  application:
    name: demo-service

server:
  port: 8080

app:
  message: "Hello from Config Server!"
  version: "1.0.0"
```

Link the config server to your Git repository:

```bash
az spring-cloud config-server set \
    --name my-spring-cloud \
    --resource-group rg-springcloud-demo \
    --config-file config-server.json
```

Where `config-server.json` contains:

```json
{
    "spring.cloud.config.server.git": {
        "uri": "https://github.com/yourusername/config-repo",
        "default-label": "main",
        "search-paths": ["config"]
    }
}
```

## Enabling Distributed Tracing

Azure Spring Cloud integrates seamlessly with Application Insights for distributed tracing:

```bash
# Enable Application Insights
az spring-cloud app-insights update \
    --name my-spring-cloud \
    --resource-group rg-springcloud-demo \
    --app-insights-key <your-instrumentation-key>
```

In your application, add the dependency:

```xml
<dependency>
    <groupId>com.microsoft.azure</groupId>
    <artifactId>applicationinsights-spring-boot-starter</artifactId>
    <version>2.6.3</version>
</dependency>
```

## Blue-Green Deployments

One of the best features is zero-downtime deployments using staging slots:

```bash
# Create a staging deployment
az spring-cloud app deployment create \
    --name staging \
    --app demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud \
    --jar-path target/demo-service-0.0.2-SNAPSHOT.jar

# Test the staging deployment
az spring-cloud app show \
    --name demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud

# Swap to production
az spring-cloud app set-deployment \
    --name demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud \
    --deployment staging
```

## Scaling Your Application

Scale your application horizontally or vertically:

```bash
# Scale out to 3 instances
az spring-cloud app scale \
    --name demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud \
    --instance-count 3

# Scale up resources
az spring-cloud app scale \
    --name demo-service \
    --resource-group rg-springcloud-demo \
    --service my-spring-cloud \
    --cpu 2 \
    --memory 4Gi
```

## Conclusion

Azure Spring Cloud significantly simplifies the deployment and management of Spring Boot microservices. With built-in service discovery, config management, and observability, you can focus on building your applications instead of managing infrastructure.

In future posts, we'll explore more advanced topics like VNet integration, custom domains, and integrating with other Azure services like Azure Database for MySQL and Azure Redis Cache.

Happy coding!

