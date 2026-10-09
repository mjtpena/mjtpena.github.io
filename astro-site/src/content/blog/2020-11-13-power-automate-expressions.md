---
title: "Power Automate Expressions: Dynamic Flow Logic"
description: "Expressions turn simple flows into powerful automation."
author: Michael John Peña
draft: false
date: 2020-11-13
tags:
  - Power Automate
  - Power Platform
  - Low-Code
  - Automation
---

## Expression Basics

```
@{expression}                    // Inline in text
@triggerOutputs()                // Get trigger data
@body('actionName')              // Get action output
@variables('myVar')              // Get variable value
```

## String Functions

```
// Concatenation
concat('Hello, ', triggerBody()?['name'])

// Substring
substring('Hello World', 0, 5)  // "Hello"

// Replace
replace('Hello World', 'World', 'Power Automate')

// Split
split('a,b,c', ',')  // ["a", "b", "c"]

// Join
join(variables('myArray'), '; ')

// Upper/Lower
toUpper('hello')  // "HELLO"
toLower('HELLO')  // "hello"

// Trim
trim('  hello  ')  // "hello"

// Length
length('Hello')  // 5

// Contains
contains('Hello World', 'World')  // true

// StartsWith / EndsWith
startsWith('Hello', 'He')  // true
endsWith('Hello', 'lo')    // true
```

## Date/Time Functions

```
// Current time
utcNow()                          // 2020-11-13T10:30:00Z
utcNow('yyyy-MM-dd')              // 2020-11-13

// Add/subtract time
addDays(utcNow(), 7)              // Add 7 days
addHours(utcNow(), -2)            // Subtract 2 hours
addMinutes(utcNow(), 30)

// Format date
formatDateTime(utcNow(), 'MMMM dd, yyyy')  // November 13, 2020

// Parse date
parseDateTime('2020-11-13')

// Date parts
dayOfWeek(utcNow())               // 5 (Friday)
dayOfMonth(utcNow())              // 13
dayOfYear(utcNow())               // 318

// Difference
dateDifference(startDate, endDate)

// Convert timezone
convertTimeZone(utcNow(), 'UTC', 'Pacific Standard Time')
```

## Conditional Functions

```
// If condition
if(equals(triggerBody()?['status'], 'approved'), 'Yes', 'No')

// Coalesce (first non-null)
coalesce(triggerBody()?['phone'], triggerBody()?['mobile'], 'No phone')

// Null check
if(empty(triggerBody()?['email']), 'No email', triggerBody()?['email'])

// Multiple conditions
if(
    and(
        greater(variables('amount'), 1000),
        equals(variables('approved'), true)
    ),
    'Large approved order',
    'Other'
)
```

## Array Functions

```
// First/Last
first(body('Get_items')?['value'])
last(body('Get_items')?['value'])

// Length
length(body('Get_items')?['value'])

// Filter
@{body('Get_items')?['value']}
// In Filter array action: @equals(item()?['status'], 'Active')

// Select (map)
// In Select action: item()?['name']

// Union/Intersection
union(array1, array2)
intersection(array1, array2)

// Contains
contains(variables('myArray'), 'searchValue')

// Index access
body('Get_items')?['value'][0]?['name']
```

## Math Functions

```
// Basic math
add(5, 3)         // 8
sub(10, 4)        // 6
mul(3, 4)         // 12
div(10, 2)        // 5

// Min/Max
min(1, 2, 3)      // 1
max(1, 2, 3)      // 3

// Random
rand(1, 100)      // Random number 1-100

// Round
round(3.7)        // 4
```

## JSON Functions

```
// Parse JSON
json('{"name":"John"}')

// Create JSON
json(concat('{"name":"', variables('name'), '"}'))

// Access nested properties
body('HTTP')?['data']?['user']?['email']

// XPath for XML
xpath(xml(body('HTTP')), '//item/name/text()')
```

## Common Patterns

### Null-Safe Property Access

```
// Use ? for optional chaining
triggerBody()?['customer']?['address']?['city']

// Default value if null
coalesce(triggerBody()?['priority'], 'Normal')
```

### Dynamic Recipients

```
// Email to multiple people
join(body('Get_approvers')?['value'], ';')
```

### File Name from Path

```
// Extract filename from path
last(split(triggerBody()?['Path'], '/'))
```

Expressions turn simple flows into powerful automation.
