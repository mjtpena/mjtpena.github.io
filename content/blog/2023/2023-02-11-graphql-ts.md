---
title: "Getting Started with GraphQL using TypeScript"
author: Michael John Peña
draft: false
date: 2023-02-11
image: /2023/02/graphql-ts.png
url: /blog/graphql-ts/
tags:
  - GraphQL
  - API
  - Backend
  - TypeScript
  - Software
---

GraphQL is a modern query language for APIs that provides more control and efficiency compared to traditional REST APIs. With GraphQL, clients can specify exactly what data they need, and the server will return only that data, reducing the amount of over or under-fetching of data.

TypeScript is a statically typed language that is a popular choice for building large-scale applications. It provides improved reliability, maintainability, and readability compared to dynamically typed languages like JavaScript.

In this blog post, we’ll show you how to get started with GraphQL and TypeScript by building a simple GraphQL server and client application. We’ll also introduce you to Apollo Client, a popular library for building GraphQL clients.

# Building the GraphQL Server

First, let's start by setting up a GraphQL server. For this example, we’ll be using the express-graphql middleware, which allows us to easily add a GraphQL endpoint to an Express server.

To get started, create a new directory and navigate into it in your terminal:

```bash
mkdir graphql-typescript-example
cd graphql-typescript-example
```

Next, initialize a new Node.js project and install the required dependencies:

```bash
npm init -y
npm install express express-graphql graphql @types/express @types/graphql

```

Once the dependencies are installed, create a new file called index.ts in your project directory and add the following code:

```typescript
import express from "express"
import { ApolloServer, gql } from "apollo-server-express"

const app = express()
const port = 3000

const typeDefs = gql`
  type Query {
    hello: String!
  }
`

const resolvers = {
  Query: {
    hello: () => "Hello, World!",
  },
}

const server = new ApolloServer({ typeDefs, resolvers })

server.applyMiddleware({ app })

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
```

In this code, we’re using the ApolloServer class from the apollo-server-express package to define a GraphQL server. We’re also using the gql template literal tag from the graphql package to define our GraphQL schema. Our schema consists of a single query, hello, which returns a string.

Next, let’s start the server by running the following command:

```bash
npx ts-node index.ts
```

You should now be able to access the GraphQL endpoint by visiting http://localhost:3000/graphql in your browser. You can also test your GraphQL query by entering the following in the GraphiQL interface:

```graphql
query {
  hello
}
```

# Building the GraphQL Client

Now that our GraphQL server is up and running, let's create a client to consume the GraphQL service. To do this, we’ll use React and Apollo Client.

First, let's install the required dependencies:

```bash
npm install react react-dom @apollo/client @apollo/react-hooks @types/react @types/react

```

Next, let's create a new React component that will display the result of our GraphQL query. Create a new file called `App.tsx` in your project directory and add the following code:

```typescript
import React from "react"
import { useQuery } from "@apollo/react-hooks"
import { gql } from "apollo-boost"

const HELLO_QUERY = gql`
  query HelloQuery {
    hello
  }
`

const App = () => {
  const { loading, error, data } = useQuery(HELLO_QUERY)

  if (loading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>

  return <p>Result: {data.hello}</p>
}

export default App
```

In this code, we’re using the useQuery hook from the @apollo/react-hooks package to query the GraphQL server. We’re also using the gql template literal tag from the apollo-boost package to define our GraphQL query.

Finally, let's update the index.tsx file to render our React component:

```typescript
import React from "react"
import ReactDOM from "react-dom"
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import { ApolloProvider } from "@apollo/react-hooks"
import App from "./App"

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: new HttpLink({
    uri: "http://localhost:3000/graphql",
  }),
})

ReactDOM.render(
  <ApolloProvider client={client}>
    <App />
  </ApolloProvider>,
  document.getElementById("root"),
)
```

In this code, we’re using the ApolloProvider component from the @apollo/react-hooks package to provide the ApolloClient instance to our React component.

# Running and Testing the Application

To run the application, you can use the following command in your terminal:

```bash
npm run start
```

This will start the GraphQL server on http://localhost:3000/graphql. You should see the message "Server running on http://localhost:3000/graphql" in the terminal when the server has started successfully.

To test the client application, open your web browser and navigate to http://localhost:3001. You should see a message with the result of your GraphQL query, "Result: Hello, World!".

If everything is working correctly, you now have a working GraphQL server and client application built with TypeScript and Apollo Client. Congratulations!

To further test your GraphQL API, you can use tools like [GraphQL Playground](https://github.com/prisma-labs/graphql-playground) or [GraphiQL](https://github.com/graphql/graphiql). These tools provide a UI for you to send queries and mutations to your GraphQL API, which can be useful for testing and development purposes.

# Conclusion

In this blog post, we showed you how to get started with GraphQL and TypeScript by building a simple GraphQL server and client application. We also introduced you to Apollo Client, a popular library for building GraphQL clients.

Whether you’re just starting out with GraphQL or looking to upgrade your existing APIs, I highly recommend giving it a try. With GraphQL, you can provide your clients with more control and efficiency, and with TypeScript, you can take advantage of its statically typed nature to write safer and more maintainable code.
