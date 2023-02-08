---
title: "TDD (Test-Driven Development) Overview with NextJS Example"
author: MJ Peña
draft: false
date: 2023-02-07
image: /2023/02/tdd-nextjs.png
url: /blog/tdd-nextjs/
tags:
  - TDD
  - Testing
  - NextJS
  - Software
---

Test-Driven Development (TDD) is a software development methodology that emphasizes writing tests before writing code. This approach helps developers catch bugs early and ensures that the code they write is maintainable, scalable, and well-documented. In this blog post, we will take a look at how to get started with TDD in a [NextJS](https://nextjs.org/) and TypeScript project.

I've also done similar posts in the past:

- [Rust](https://michaeljohnpena.com/blog/rust-tdd/)
- [TypeScript](https://michaeljohnpena.com/blog/typescript-tdd/) (vanilla)
- [Python](https://michaeljohnpena.com/blog/tdd-python/)

# Prerequisites

Before we get started, you'll need to have a basic understanding of NextJS, TypeScript, and testing. You should also have the following tools installed on your machine:

- NodeJS
- npm or yarn
- NextJS
- TypeScript

# Setting up a NextJS project with TypeScript

To set up a NextJS project with TypeScript, you can use the following command:

```bash
npx create-next-app my-app --use-npm --example with-typescript
```

This will create a new NextJS project with TypeScript in a directory named my-app. Change into the directory and run npm run dev to start the development server. You should see the default NextJS landing page in your browser.

# Setting up Jest for testing

[Jest](https://jestjs.io/) is a popular testing framework for JavaScript that provides a simple and intuitive API for writing tests. To set up Jest in a NextJS and TypeScript project, you need to install the following packages:

```bash
npm install --save-dev jest @types/jest ts-jest
```

Then, create a jest.config.js file in the root of your project and add the following code:

```TypeScript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};
```

This sets up Jest to use the TypeScript preset and runs tests in a Node environment.

# Writing your first test

Now that we have Jest set up, let's write our first test. Create a **tests** directory in the root of your project and add a new file named hello.test.ts. In this file, we will write a test to check that the text "Hello, World!" is displayed on the page.

```TypeScript
import { render } from 'next/testing';

describe('Hello', () => {
  it('renders the text "Hello, World!"', async () => {
    const { getByText } = await render('/');
    expect(getByText('Hello, World!')).toBeDefined();
  });
});
```

In this test, we use the render function from the next/testing module to render the default NextJS landing page. We then use the getByText function to find an element with the text "Hello, World!" on the page. Finally, we use Jest's expect function to check that the element is defined.

# Running the test

To run the test, you can use the following command:

```bash
npm run test
```

This will run Jest and display the results of the test. If the test passes, you should see a message like the following:

```bash
 PASS  __tests__/hello.test.ts
  Hello
    ✓ renders the text "Hello, World!" (8ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:
```

# Writing the code

Now that we have written our first test, it's time to write the code to make it pass. Open the pages/index.tsx file and replace the existing code with the following:

```TypeScript
import React from 'react';

const Home = () => <div>Hello, World!</div>;

export default Home;
```

This code defines a simple React component that displays the text "Hello, World!".

# Refreshing the test

With the code in place, we can now rerun the test to see if it passes. Use the following command:

```bash
npm run test
```

This time, the test should pass, and you should see a message like the following:

```bash
 PASS  __tests__/hello.test.ts
  Hello
    ✓ renders the text "Hello, World!" (8ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        1.82s
Ran all test suites.
```

# Conclusion

In this blog post, we have taken a look at how to get started with TDD in a NextJS and TypeScript project. By writing tests before writing code, we can catch bugs early and ensure that our code is maintainable, scalable, and well-documented. By using Jest and the next/testing module, we can easily write and run tests for NextJS components.
