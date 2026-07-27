---
title: "AI Pair Programming with ChatGPT: A New Development Paradigm"
author: Michael John Peña
draft: false
date: 2022-12-02
tags:
  - AI
  - ChatGPT
  - Pair Programming
  - Development
  - Productivity

---

I wrote "AI Pair Programming with ChatGPT: A New Development Paradigm" to share practical, production-minded guidance on this topic.

## The AI Pair Programming Experience

Traditional pair programming has a driver (typing) and navigator (reviewing). With ChatGPT:

- **You're the driver**: You maintain control, make decisions, write final code
- **ChatGPT navigates**: Suggests approaches, catches issues, explains alternatives

## Workflow Example: Building an API

Let's walk through building a REST API with ChatGPT as our pair.

### Step 1: Planning

**Me**: "I need to build a REST API for a task management system. The requirements are: users can create tasks, assign them to team members, set due dates, and mark them complete. What architecture would you suggest?"

**ChatGPT**: Suggests Clean Architecture with:
- Controllers (Presentation)
- Application services (Business logic)
- Domain entities
- Infrastructure (Database, external services)

We discuss tradeoffs and agree on the approach.

### Step 2: Domain Modeling

**Me**: "Let's start with the domain entities. Here's my initial Task entity - what do you think?"

```csharp
public class TaskItem
{
    public Guid Id { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }
    public DateTime? DueDate { get; set; }
    public bool IsComplete { get; set; }
    public Guid AssigneeId { get; set; }
}
```

**ChatGPT**: Suggests improvements:
- Add `CreatedAt` and `UpdatedAt` timestamps
- Use `record` for immutability
- Add status enum instead of boolean
- Consider value objects for Title
- Add domain events for state changes

We iterate together:

```csharp
public record TaskItem
{
    public Guid Id { get; init; }
    public TaskTitle Title { get; init; } = null!;
    public string? Description { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; private set; }
    public DateTime? DueDate { get; init; }
    public TaskStatus Status { get; private set; }
    public Guid? AssigneeId { get; private set; }

    private readonly List<IDomainEvent> _domainEvents = new();
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    public void MarkComplete()
    {
        if (Status == TaskStatus.Completed)
            return;

        Status = TaskStatus.Completed;
        UpdatedAt = DateTime.UtcNow;
        _domainEvents.Add(new TaskCompletedEvent(Id));
    }

    public void AssignTo(Guid userId)
    {
        AssigneeId = userId;
        UpdatedAt = DateTime.UtcNow;
        _domainEvents.Add(new TaskAssignedEvent(Id, userId));
    }
}

public record TaskTitle
{
    public string Value { get; }

    public TaskTitle(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException("Title cannot be empty", nameof(value));

        if (value.Length > 200)
            throw new ArgumentException("Title cannot exceed 200 characters", nameof(value));

        Value = value;
    }
}

public enum TaskStatus
{
    Pending,
    InProgress,
    Completed,
    Cancelled
}
```

### Step 3: Service Layer

**Me**: "Now let's implement the application service. I want to handle task creation with validation."

We collaborate on the service:

```csharp
public class TaskService : ITaskService
{
    private readonly ITaskRepository _repository;
    private readonly IUserRepository _userRepository;
    private readonly IEventPublisher _eventPublisher;

    public TaskService(
        ITaskRepository repository,
        IUserRepository userRepository,
        IEventPublisher eventPublisher)
    {
        _repository = repository;
        _userRepository = userRepository;
        _eventPublisher = eventPublisher;
    }

    public async Task<Result<TaskItem>> CreateTaskAsync(
        CreateTaskRequest request,
        CancellationToken cancellationToken)
    {
        // Validate assignee exists if provided
        if (request.AssigneeId.HasValue)
        {
            var assigneeExists = await _userRepository.ExistsAsync(
                request.AssigneeId.Value,
                cancellationToken);

            if (!assigneeExists)
            {
                return Result<TaskItem>.Failure("Assignee not found");
            }
        }

        // Create domain entity
        var task = new TaskItem
        {
            Id = Guid.NewGuid(),
            Title = new TaskTitle(request.Title),
            Description = request.Description,
            DueDate = request.DueDate,
            CreatedAt = DateTime.UtcNow,
            Status = TaskStatus.Pending
        };

        if (request.AssigneeId.HasValue)
        {
            task.AssignTo(request.AssigneeId.Value);
        }

        // Persist
        await _repository.AddAsync(task, cancellationToken);

        // Publish domain events
        foreach (var domainEvent in task.DomainEvents)
        {
            await _eventPublisher.PublishAsync(domainEvent, cancellationToken);
        }

        return Result<TaskItem>.Success(task);
    }
}
```

### Step 4: Debugging Together

**Me**: "I'm getting a null reference exception on line 42. Here's the stack trace..."

**ChatGPT**: Analyzes the code path, identifies that `_userRepository` might not be properly registered in DI, and suggests:
1. Check service registration
2. Add null check with meaningful error
3. Consider using the null object pattern

### Step 5: Testing

**Me**: "Help me write tests for the CreateTaskAsync method."

We build comprehensive tests together:

```csharp
public class TaskServiceTests
{
    private readonly Mock<ITaskRepository> _taskRepoMock;
    private readonly Mock<IUserRepository> _userRepoMock;
    private readonly Mock<IEventPublisher> _eventPublisherMock;
    private readonly TaskService _sut;

    public TaskServiceTests()
    {
        _taskRepoMock = new Mock<ITaskRepository>();
        _userRepoMock = new Mock<IUserRepository>();
        _eventPublisherMock = new Mock<IEventPublisher>();
        _sut = new TaskService(
            _taskRepoMock.Object,
            _userRepoMock.Object,
            _eventPublisherMock.Object);
    }

    [Fact]
    public async Task CreateTaskAsync_WithValidRequest_ReturnsSuccess()
    {
        // Arrange
        var request = new CreateTaskRequest
        {
            Title = "Test Task",
            Description = "Test Description"
        };

        // Act
        var result = await _sut.CreateTaskAsync(request, CancellationToken.None);

        // Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Test Task", result.Value.Title.Value);
        _taskRepoMock.Verify(r => r.AddAsync(
            It.IsAny<TaskItem>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CreateTaskAsync_WithInvalidAssignee_ReturnsFailure()
    {
        // Arrange
        var nonExistentUserId = Guid.NewGuid();
        _userRepoMock.Setup(r => r.ExistsAsync(nonExistentUserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var request = new CreateTaskRequest
        {
            Title = "Test Task",
            AssigneeId = nonExistentUserId
        };

        // Act
        var result = await _sut.CreateTaskAsync(request, CancellationToken.None);

        // Assert
        Assert.False(result.IsSuccess);
        Assert.Contains("not found", result.Error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task CreateTaskAsync_WithEmptyTitle_ThrowsException(string title)
    {
        // Arrange
        var request = new CreateTaskRequest { Title = title };

        // Act & Assert
        await Assert.ThrowsAsync<ArgumentException>(() =>
            _sut.CreateTaskAsync(request, CancellationToken.None));
    }
}
```

## Effective Collaboration Techniques

### 1. Think Aloud
Share your reasoning: "I'm thinking about using an enum here because..."

### 2. Ask for Alternatives
"What are other ways to implement this? What are the tradeoffs?"

### 3. Challenge Suggestions
"Why did you suggest X instead of Y?"

### 4. Request Explanations
"I don't understand this part. Can you explain?"

### 5. Iterative Refinement
"That's close, but change the error handling to..."

## When AI Pair Programming Shines

- **Learning new technologies**: The AI explains as you go
- **Boilerplate generation**: Let AI handle repetitive code
- **Code review**: Fresh perspective on your code
- **Documentation**: Generate docs from code
- **Testing**: Generate test cases you might miss

## When to Take the Lead

- **Architecture decisions**: You understand the full context
- **Business logic**: Domain knowledge is yours
- **Security**: Don't trust AI with security-critical decisions
- **Performance**: Profile and measure, don't assume

## Conclusion

AI pair programming with ChatGPT is a powerful new tool in the developer toolkit. It's not about replacing human collaboration - it's about augmenting your capabilities when you're working solo. The key is learning when to lead and when to follow the AI's suggestions.

## Resources

- [ChatGPT](https://chat.openai.com/)
- [Pair Programming Best Practices](https://martinfowler.com/articles/on-pair-programming.html)

