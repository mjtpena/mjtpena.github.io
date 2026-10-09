---
title: "Azure Spring Cloud: Managed Spring Boot Platform"
description: "Azure Spring Cloud: enterprise Java without infrastructure burden."
author: Michael John Peña
draft: false
date: 2020-12-15
tags:
  - Azure
  - Spring Cloud
  - Java
  - Microservices
---

## Creating Spring Cloud Service

```bash
# Install extension
az extension add --name spring-cloud

# Create service instance
az spring-cloud create \
    --name my-spring-cloud \
    --resource-group myRG \
    --location eastus \
    --sku Standard
```

## Deploy Application

```bash
# Build JAR
./mvnw clean package -DskipTests

# Create app
az spring-cloud app create \
    --name my-app \
    --service my-spring-cloud \
    --resource-group myRG \
    --runtime-version Java_11 \
    --instance-count 2 \
    --memory 2Gi

# Deploy JAR
az spring-cloud app deploy \
    --name my-app \
    --service my-spring-cloud \
    --resource-group myRG \
    --artifact-path target/my-app-1.0.0.jar
```

## Spring Boot Application

```java
@SpringBootApplication
@RestController
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }

    @GetMapping("/hello")
    public String hello(@RequestParam(defaultValue = "World") String name) {
        return String.format("Hello, %s!", name);
    }
}
```

```xml
<!-- pom.xml -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.4.0</version>
</parent>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
</dependencies>
```

## Config Server

```bash
# Set up config server with Git repo
az spring-cloud config-server git set \
    --name my-spring-cloud \
    --resource-group myRG \
    --uri https://github.com/myorg/config-repo \
    --branch main \
    --search-paths config
```

```yaml
# Config repo: config/my-app.yml
server:
  port: 8080

app:
  message: "Hello from Config Server"
  feature:
    enabled: true
```

## Service Registry

Built-in Eureka service discovery:

```java
// Application automatically registers
// Access other services by name
@Service
public class OrderService {

    @Autowired
    private RestTemplate restTemplate;

    public Product getProduct(String productId) {
        return restTemplate.getForObject(
            "http://product-service/products/{id}",
            Product.class,
            productId
        );
    }
}

@Configuration
public class AppConfig {
    @Bean
    @LoadBalanced
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
```

## Distributed Tracing

```bash
# Enable Application Insights
az spring-cloud app-insights update \
    --name my-spring-cloud \
    --resource-group myRG \
    --app-insights my-app-insights \
    --sampling-rate 100
```

```java
// Automatic tracing with Sleuth
// Add dependency
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-sleuth</artifactId>
</dependency>

// Traces automatically sent to Application Insights
```

## Blue-Green Deployment

```bash
# Create staging deployment
az spring-cloud app deployment create \
    --name staging \
    --app my-app \
    --service my-spring-cloud \
    --resource-group myRG \
    --artifact-path target/my-app-2.0.0.jar

# Test staging
curl https://my-spring-cloud-my-app-staging.azuremicroservices.io/hello

# Swap to production
az spring-cloud app set-deployment \
    --name my-app \
    --service my-spring-cloud \
    --resource-group myRG \
    --deployment staging
```

## Autoscaling

```bash
az spring-cloud app scale \
    --name my-app \
    --service my-spring-cloud \
    --resource-group myRG \
    --instance-count 3 \
    --cpu 2 \
    --memory 4Gi
```

## Custom Domain and SSL

```bash
# Add custom domain
az spring-cloud app custom-domain bind \
    --app my-app \
    --service my-spring-cloud \
    --resource-group myRG \
    --domain-name api.mycompany.com

# Upload certificate
az spring-cloud certificate add \
    --name my-cert \
    --service my-spring-cloud \
    --resource-group myRG \
    --vault-uri https://myvault.vault.azure.net \
    --vault-certificate-name my-cert
```

Azure Spring Cloud: enterprise Java without infrastructure burden.
