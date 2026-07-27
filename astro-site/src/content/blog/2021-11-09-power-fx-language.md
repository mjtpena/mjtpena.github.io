---
title: "Power Fx: The Low-Code Programming Language for Everyone"
author: Michael John Pena
draft: false
date: 2021-11-09
tags:
  - Power Platform
  - Power Fx
  - Low Code
  - Programming
  - Microsoft

---

I wrote "Power Fx: The Low-Code Programming Language for Everyone" to share practical, production-minded guidance on this topic.

## Why Power Fx?

Power Fx bridges the gap between spreadsheets and applications:

- **Familiar syntax**: If you know Excel, you know Power Fx
- **Strongly typed**: Catch errors before runtime
- **Declarative**: Describe what you want, not how to do it
- **Open source**: Community-driven and transparent

## Basic Syntax

Power Fx uses Excel-like formulas:

```powerfx
// Simple calculations
5 + 3                           // Returns 8
"Hello" & " " & "World"         // Returns "Hello World"
Today() + 7                     // Returns date 7 days from now

// Conditional logic
If(Score >= 90, "A", If(Score >= 80, "B", "C"))

// Working with tables
Filter(Employees, Department = "Sales")
Sort(Products, Price, Descending)
Sum(Orders, Total)

// First, Last, Index
First(Customers).Name
Last(Sort(Orders, Date)).Total
Index(Products, 5).Name
```

## Data Types and Variables

```powerfx
// Setting variables
Set(Counter, 0);
Set(UserName, User().FullName);
Set(CurrentDate, Today());

// Collections (in-memory tables)
ClearCollect(
    CartItems,
    { Product: "Widget", Quantity: 2, Price: 9.99 },
    { Product: "Gadget", Quantity: 1, Price: 24.99 }
);

// Updating variables
Set(Counter, Counter + 1);
UpdateIf(Counter, true, Counter + 1);

// Context variables (screen-scoped)
UpdateContext({ ShowDialog: true });
UpdateContext({ SelectedItem: ThisItem });
```

## Working with Records and Tables

```powerfx
// Creating records
{
    Name: "John Doe",
    Email: "john@example.com",
    Age: 30,
    Active: true
}

// Accessing fields
Person.Name
Person.Email

// Table operations
// Filter - select rows
Filter(
    Employees,
    Department = "Engineering" && YearsOfService > 5
)

// Sort - order rows
Sort(Products, Name, Ascending)
SortByColumns(Products, "Category", Ascending, "Name", Ascending)

// AddColumns - add calculated columns
AddColumns(
    Orders,
    "TotalWithTax", Total * 1.1,
    "DaysOld", DateDiff(OrderDate, Today(), Days)
)

// GroupBy - aggregate data
GroupBy(
    Sales,
    "Region",
    "RegionalSales",
    Sum(Sales, Amount)
)

// Distinct - unique values
Distinct(Customers, Country)

// Search - text search
Search(Products, SearchInput.Text, "Name", "Description")
```

## Control Structures

```powerfx
// If-Then-Else
If(
    Temperature > 30, "Hot",
    Temperature > 20, "Warm",
    Temperature > 10, "Cool",
    "Cold"
)

// Switch
Switch(
    DayOfWeek,
    1, "Sunday",
    2, "Monday",
    3, "Tuesday",
    4, "Wednesday",
    5, "Thursday",
    6, "Friday",
    7, "Saturday",
    "Unknown"
)

// Coalesce - first non-blank value
Coalesce(
    User().Email,
    User().FullName,
    "Anonymous"
)

// With - temporary variables
With(
    {
        subtotal: Sum(CartItems, Price * Quantity),
        taxRate: 0.1
    },
    subtotal + (subtotal * taxRate)
)

// ForAll - iterate and transform
ForAll(
    Employees,
    Patch(
        Employees,
        ThisRecord,
        { ReviewDate: Today() }
    )
)
```

## Error Handling

```powerfx
// IfError - handle errors gracefully
IfError(
    1/0,
    Notify("Cannot divide by zero", NotificationType.Error);
    0
)

// IsError - check for errors
If(
    IsError(Value(TextInput.Text)),
    Notify("Please enter a valid number"),
    Set(Amount, Value(TextInput.Text))
)

// IsBlank and IsEmpty
If(IsBlank(CustomerName), "Name required", "Valid")
If(IsEmpty(SearchResults), "No results found", "Found " & CountRows(SearchResults) & " results")

// Validate before submit
If(
    IsBlank(NameInput.Text) || IsBlank(EmailInput.Text),
    Notify("Please fill in all required fields", NotificationType.Error),
    SubmitForm(CustomerForm)
)
```

## Date and Time Functions

```powerfx
// Current date and time
Today()                         // Date only
Now()                          // Date and time
Time(14, 30, 0)               // 2:30 PM

// Date components
Year(Today())
Month(Today())
Day(Today())
Weekday(Today())

// Date arithmetic
DateAdd(Today(), 30, Days)
DateDiff(StartDate, EndDate, Days)
DateDiff(StartDate, EndDate, Months)

// Formatting
Text(Today(), "mmmm dd, yyyy")           // "November 09, 2021"
Text(Now(), "hh:mm:ss AM/PM")            // "02:30:00 PM"
Text(OrderDate, "[$-en-US]dddd")         // "Tuesday"

// Date parsing
DateValue("2021-11-09")
DateTimeValue("2021-11-09 14:30:00")
```

## Text Functions

```powerfx
// String manipulation
Upper("hello")                  // "HELLO"
Lower("HELLO")                  // "hello"
Proper("john doe")             // "John Doe"

// Concatenation
"Hello" & " " & "World"
Concatenate("Hello", " ", "World")

// Substring operations
Left("Hello World", 5)          // "Hello"
Right("Hello World", 5)         // "World"
Mid("Hello World", 7, 5)        // "World"

// Finding and replacing
Find("World", "Hello World")    // 7 (1-based index)
Substitute("Hello World", "World", "Universe")  // "Hello Universe"

// Trimming and padding
Trim("  Hello  ")               // "Hello"
TrimEnds("  Hello  ")           // "Hello"

// Splitting and joining
Split("a,b,c", ",")             // Table with "a", "b", "c"
Concat(Products, Name, ", ")    // "Widget, Gadget, Doohickey"
```

## Working with JSON

```powerfx
// Parse JSON string
Set(
    ParsedData,
    ParseJSON(JsonString)
);

// Access JSON properties
Text(ParsedData.name)
Value(ParsedData.age)
Table(ParsedData.items)

// Create JSON
JSON(
    {
        name: "John",
        email: "john@example.com",
        orders: [
            { id: 1, total: 99.99 },
            { id: 2, total: 149.99 }
        ]
    }
)
```

## Connecting to Data Sources

```powerfx
// Read from data source
Items from SharePoint list: Products

// Filter at data source (delegation)
Filter(Products, Category = "Electronics")  // Delegated to SharePoint
Filter(Products, Price > 100)               // Delegated
Filter(Products, StartsWith(Name, "A"))     // Delegated

// Non-delegable operations (processed locally)
Filter(Products, Len(Name) > 10)            // Warning: not delegated

// Patch - create or update records
Patch(
    Customers,
    Defaults(Customers),
    {
        Name: NameInput.Text,
        Email: EmailInput.Text,
        CreatedDate: Now()
    }
)

// Remove records
Remove(Customers, ThisItem);
RemoveIf(Orders, Status = "Cancelled");
```

## Building Reusable Components

```powerfx
// Component with custom properties
// Input property: Items (Table)
// Input property: DisplayField (Text)
// Output property: SelectedItem (Record)

// Inside component:
Gallery1.Items = Component.Items
Gallery1.OnSelect = Set(Component.SelectedItem, ThisItem)
Label1.Text = ThisItem[Component.DisplayField]

// Using the component:
MyListComponent.Items = Customers
MyListComponent.DisplayField = "Name"
Set(ChosenCustomer, MyListComponent.SelectedItem)
```

## Named Formulas and User-Defined Functions

```powerfx
// Named formulas (calculated values that auto-refresh)
ActiveUsers = CountRows(Filter(Users, IsActive))
TotalRevenue = Sum(Orders, Amount)
TopProduct = First(Sort(Products, Sales, Descending)).Name

// Using named formulas
If(ActiveUsers > 100, "High traffic", "Normal")
Text(TotalRevenue, "$#,###.00")
"Best seller: " & TopProduct
```

Power Fx makes programming accessible to everyone who knows Excel. As it expands across the Power Platform and beyond, expect to see it become a standard skill for business users.

## Resources

- [Power Fx Overview](https://docs.microsoft.com/en-us/power-platform/power-fx/overview)
- [Formula Reference](https://docs.microsoft.com/en-us/power-platform/power-fx/formula-reference)
- [Power Fx on GitHub](https://github.com/microsoft/Power-Fx)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
