---
title: Power Apps Canvas Apps - Building Mobile-First Experiences
description: "Canvas apps are where I've seen Power Apps deliver the most visible value to end users: a field inspection app for a construction site, a stock-take app…"
author: Michael John Peña
draft: false
date: 2021-04-06
url: /blog/power-apps-canvas-apps-building-mobile-experiences/
tags:
  - Power Platform
  - Power Apps
  - Canvas Apps
  - Mobile Development
  - Low-Code
---

Canvas apps are where I've seen Power Apps deliver the most visible value to end users: a field inspection app for a construction site, a stock-take app that works offline on a shared iPad, a custom approval workflow with an interface that actually makes sense to the people using it. The pixel-perfect control is the appeal—you're not constrained by model-driven's standard forms. The discipline required is thinking about screens like you'd think about component libraries: gallery controls for lists, reusable components for headers and footers, named formulas for expensive data calls that shouldn't fire on every screen. The responsive layout controls that arrived in 2021 make mobile/tablet variants manageable.

## Canvas App Fundamentals

Canvas apps are ideal when you need:
- Custom UI/UX designs
- Specific layout requirements
- Integration with multiple data sources
- Mobile-optimized experiences

## Setting Up Responsive Layouts

### Configure App Settings

```yaml
App Settings:
  Scale to fit: Off
  Lock aspect ratio: Off
  Lock orientation: Off

Screen Size:
  Width: Max(App.Width, App.DesignWidth)
  Height: Max(App.Height, App.DesignHeight)
```

### Responsive Container Pattern

```powerapps
// Main Container
Container_Main:
  X: 0
  Y: 0
  Width: Parent.Width
  Height: Parent.Height

// Header
Container_Header:
  X: 0
  Y: 0
  Width: Parent.Width
  Height: 60

// Content Area
Container_Content:
  X: 0
  Y: Container_Header.Height
  Width: Parent.Width
  Height: Parent.Height - Container_Header.Height - Container_Footer.Height

// Footer
Container_Footer:
  X: 0
  Y: Parent.Height - 50
  Width: Parent.Width
  Height: 50
```

## Data Handling Patterns

### Initialize Collections on App Start

```powerapps
// App.OnStart
ClearCollect(
    colProjects,
    Filter(
        Projects,
        Status.Value <> "Archived" &&
        Owner.Email = User().Email
    )
);

ClearCollect(
    colTaskStatuses,
    {Value: "Not Started", Color: RGBA(128, 128, 128, 1)},
    {Value: "In Progress", Color: RGBA(0, 120, 212, 1)},
    {Value: "Completed", Color: RGBA(16, 124, 16, 1)},
    {Value: "Blocked", Color: RGBA(196, 49, 75, 1)}
);

Set(varCurrentUser, User());
Set(varIsManager,
    !IsEmpty(
        Filter(
            Managers,
            Email = User().Email
        )
    )
);
```

### Efficient Delegation

```powerapps
// Delegable filter - processes on server
Filter(
    Projects,
    StartDate >= DateAdd(Today(), -30, Days) &&
    Status.Value = "Active"
)

// Non-delegable - use collections for large datasets
// First, get delegable subset
ClearCollect(
    colFilteredProjects,
    Filter(
        Projects,
        Status.Value = "Active"
    )
);

// Then apply non-delegable operations locally
Filter(
    colFilteredProjects,
    StartsWith(Title, TextInput_Search.Text) ||
    User().Email in TeamMembers
)
```

### Concurrent Data Loading

```powerapps
// Screen.OnVisible
Concurrent(
    ClearCollect(colProjects, Projects),
    ClearCollect(colTasks, Tasks),
    ClearCollect(colTeamMembers, TeamMembers),
    Set(varSettings, First(Settings))
);
```

## Building a Project Management App

### Gallery with Details Pattern

```powerapps
// Projects Gallery
Gallery_Projects:
  Items: SortByColumns(
    Filter(
        colProjects,
        IsBlank(TextInput_Search.Text) ||
        TextInput_Search.Text in Title ||
        TextInput_Search.Text in Description
    ),
    "DueDate",
    Ascending
  )

  TemplateFill: If(
    ThisItem.IsSelected,
    RGBA(0, 120, 212, 0.1),
    RGBA(255, 255, 255, 1)
  )

// Inside Gallery Template
Label_ProjectTitle:
  Text: ThisItem.Title
  Font: Font.'Segoe UI'
  FontWeight: FontWeight.Semibold
  Size: 14

Label_DueDate:
  Text: Text(ThisItem.DueDate, "[$-en-US]mmm dd, yyyy")
  Color: If(
    ThisItem.DueDate < Today(),
    RGBA(196, 49, 75, 1),
    RGBA(128, 128, 128, 1)
  )

Icon_Status:
  Icon: If(
    ThisItem.Status.Value = "Completed",
    Icon.CheckMark,
    ThisItem.Status.Value = "Blocked",
    Icon.Warning,
    Icon.Clock
  )
  Color: LookUp(
    colTaskStatuses,
    Value = ThisItem.Status.Value
  ).Color
```

### Form with Validation

```powerapps
// Submit Button OnSelect
If(
    // Validation
    IsBlank(TextInput_Title.Text),
    Notify("Title is required", NotificationType.Error);
    Set(varTitleError, true),

    IsBlank(DatePicker_DueDate.SelectedDate),
    Notify("Due date is required", NotificationType.Error);
    Set(varDueDateError, true),

    DatePicker_DueDate.SelectedDate < Today(),
    Notify("Due date cannot be in the past", NotificationType.Error);
    Set(varDueDateError, true),

    // Validation passed - submit
    Set(varIsSubmitting, true);

    Patch(
        Projects,
        If(
            IsBlank(varSelectedProject),
            Defaults(Projects),
            varSelectedProject
        ),
        {
            Title: TextInput_Title.Text,
            Description: TextInput_Description.Text,
            DueDate: DatePicker_DueDate.SelectedDate,
            Status: Dropdown_Status.Selected,
            Priority: Dropdown_Priority.Selected,
            Owner: {
                '@odata.type': "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedUser",
                Email: User().Email,
                DisplayName: User().FullName
            }
        }
    );

    Notify("Project saved successfully", NotificationType.Success);
    Set(varIsSubmitting, false);
    Navigate(Screen_ProjectList, ScreenTransition.None)
)
```

### Custom Loading Indicator

```powerapps
// Loading Overlay Container
Container_Loading:
  Visible: varIsLoading
  X: 0
  Y: 0
  Width: Parent.Width
  Height: Parent.Height
  Fill: RGBA(0, 0, 0, 0.5)

// Spinner Image
Image_Spinner:
  Image: 'spinner.gif'
  X: (Parent.Width - Self.Width) / 2
  Y: (Parent.Height - Self.Height) / 2
  Width: 50
  Height: 50

// Or using HTML text for CSS spinner
HtmlText_Spinner:
  HtmlText: "
    <div style='
      width: 50px;
      height: 50px;
      border: 5px solid #f3f3f3;
      border-top: 5px solid #0078d4;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    '></div>
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  "
```

## Component Library

### Reusable Header Component

```powerapps
// Component: cmp_Header
// Custom Properties:
//   - Title (Text, Input)
//   - ShowBackButton (Boolean, Input)
//   - OnBackSelect (Behavior, Output)

// Header Container
Rectangle_Background:
  Fill: RGBA(0, 120, 212, 1)
  X: 0
  Y: 0
  Width: Parent.Width
  Height: 60

Icon_Back:
  Icon: Icon.ChevronLeft
  Visible: cmp_Header.ShowBackButton
  X: 10
  Y: (Parent.Height - Self.Height) / 2
  Width: 32
  Height: 32
  Color: White
  OnSelect: cmp_Header.OnBackSelect()

Label_Title:
  Text: cmp_Header.Title
  X: If(cmp_Header.ShowBackButton, 50, 16)
  Y: 0
  Width: Parent.Width - Self.X - 16
  Height: Parent.Height
  Color: White
  Font: Font.'Segoe UI'
  FontWeight: FontWeight.Semibold
  Size: 20
  VerticalAlign: VerticalAlign.Middle
```

### Reusable Card Component

```powerapps
// Component: cmp_Card
// Custom Properties:
//   - Title (Text)
//   - Subtitle (Text)
//   - IconName (Text)
//   - OnCardSelect (Behavior)

Container_Card:
  BorderRadius: 8
  BorderThickness: 1
  BorderColor: RGBA(200, 200, 200, 1)
  Fill: White
  DropShadow: DropShadow.Light
  OnSelect: cmp_Card.OnCardSelect()

Icon_Card:
  Icon: Switch(
    cmp_Card.IconName,
    "Project", Icon.DocumentSet,
    "Task", Icon.ClipboardList,
    "Team", Icon.People,
    Icon.Document
  )
  X: 16
  Y: (Parent.Height - Self.Height) / 2
  Color: RGBA(0, 120, 212, 1)

Label_CardTitle:
  Text: cmp_Card.Title
  X: 60
  Y: 12
  FontWeight: FontWeight.Semibold

Label_CardSubtitle:
  Text: cmp_Card.Subtitle
  X: 60
  Y: Label_CardTitle.Y + Label_CardTitle.Height + 4
  Color: RGBA(128, 128, 128, 1)
  Size: 12
```

## Performance Optimization

### Lazy Loading Images

```powerapps
// Only load images when visible
Image_Avatar:
  Image: If(
    Self.Visible && !IsBlank(ThisItem.ProfilePicture),
    ThisItem.ProfilePicture,
    Blank()
  )

// Use placeholder
Image_Placeholder:
  Visible: IsBlank(Image_Avatar.Image)
  Image: 'default-avatar.png'
```

### Optimize Gallery Performance

```powerapps
// Limit items loaded
Gallery_Projects:
  Items: FirstN(
    SortByColumns(colProjects, "ModifiedDate", Descending),
    50
  )
  DelayItemLoading: true
  LoadingSpinner: LoadingSpinner.Data
```

### Cache Static Data

```powerapps
// App.OnStart - Cache reference data
If(
    IsEmpty(colCachedDepartments) ||
    varCacheExpiry < Now(),

    ClearCollect(colCachedDepartments, Departments);
    Set(varCacheExpiry, DateAdd(Now(), 1, Hours))
)
```

## Best Practices

1. **Use naming conventions** - btn_, lbl_, gal_, txt_, etc.
2. **Minimize data calls** - Load once, filter locally
3. **Use components** for reusability
4. **Test on actual devices** - Performance varies
5. **Enable delayed loading** for galleries
6. **Use variables** for frequently accessed values
7. **Implement proper error handling**

## Conclusion

Canvas apps provide incredible flexibility for building custom business applications. By following responsive design patterns, optimizing data handling, and creating reusable components, you can build professional-grade applications that delight users. The key is balancing the low-code convenience with thoughtful architecture decisions that ensure performance and maintainability.
