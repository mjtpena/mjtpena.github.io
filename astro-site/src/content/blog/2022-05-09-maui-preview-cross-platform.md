---
title: ".NET MAUI Preview: Cross-Platform App Development"
author: Michael John Peña
draft: false
date: 2022-05-09
tags:
  - dotnet
  - maui
  - mobile
  - cross-platform

---

I wrote ".NET MAUI Preview: Cross-Platform App Development" to share practical, production-minded guidance on this topic.

## Getting Started with MAUI

Install the required workloads:

```bash
# Install MAUI workload
dotnet workload install maui

# Create new MAUI project
dotnet new maui -n MyMauiApp

# Build and run
cd MyMauiApp
dotnet build -t:Run -f net7.0-android
```

## Project Structure

MAUI uses a single project for all platforms:

```xml
<!-- MyMauiApp.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net7.0-android;net7.0-ios;net7.0-maccatalyst</TargetFrameworks>
    <TargetFrameworks Condition="$([MSBuild]::IsOSPlatform('windows'))">
      $(TargetFrameworks);net7.0-windows10.0.19041.0
    </TargetFrameworks>
    <OutputType>Exe</OutputType>
    <RootNamespace>MyMauiApp</RootNamespace>
    <UseMaui>true</UseMaui>
    <SingleProject>true</SingleProject>
  </PropertyGroup>

  <ItemGroup>
    <MauiIcon Include="Resources\AppIcon\appicon.svg" />
    <MauiSplashScreen Include="Resources\Splash\splash.svg" />
    <MauiImage Include="Resources\Images\*" />
    <MauiFont Include="Resources\Fonts\*" />
  </ItemGroup>
</Project>
```

## Building a Product Catalog App

Create the main app structure:

```csharp
// MauiProgram.cs
using Microsoft.Extensions.Logging;

namespace MyMauiApp;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
                fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
            });

        // Register services
        builder.Services.AddSingleton<IProductService, ProductService>();
        builder.Services.AddSingleton<IAuthService, AuthService>();
        builder.Services.AddHttpClient<IApiClient, ApiClient>(client =>
        {
            client.BaseAddress = new Uri("https://api.example.com/");
        });

        // Register ViewModels
        builder.Services.AddTransient<ProductListViewModel>();
        builder.Services.AddTransient<ProductDetailViewModel>();
        builder.Services.AddTransient<CartViewModel>();

        // Register Pages
        builder.Services.AddTransient<ProductListPage>();
        builder.Services.AddTransient<ProductDetailPage>();
        builder.Services.AddTransient<CartPage>();

#if DEBUG
        builder.Logging.AddDebug();
#endif

        return builder.Build();
    }
}
```

## MVVM with CommunityToolkit

Use the MVVM Community Toolkit for cleaner code:

```csharp
// ViewModels/ProductListViewModel.cs
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace MyMauiApp.ViewModels;

public partial class ProductListViewModel : ObservableObject
{
    private readonly IProductService _productService;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasProducts))]
    private ObservableCollection<Product> _products = new();

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _searchQuery = string.Empty;

    public bool HasProducts => Products.Count > 0;

    public ProductListViewModel(IProductService productService)
    {
        _productService = productService;
    }

    [RelayCommand]
    private async Task LoadProductsAsync()
    {
        if (IsLoading) return;

        try
        {
            IsLoading = true;
            var products = await _productService.GetProductsAsync(SearchQuery);
            Products.Clear();
            foreach (var product in products)
            {
                Products.Add(product);
            }
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlert("Error", ex.Message, "OK");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task SearchAsync()
    {
        await LoadProductsAsync();
    }

    [RelayCommand]
    private async Task NavigateToDetailAsync(Product product)
    {
        await Shell.Current.GoToAsync($"{nameof(ProductDetailPage)}",
            new Dictionary<string, object>
            {
                { "Product", product }
            });
    }
}
```

## XAML Views

Create responsive layouts:

```xml
<!-- Pages/ProductListPage.xaml -->
<?xml version="1.0" encoding="utf-8" ?>
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             xmlns:viewmodels="clr-namespace:MyMauiApp.ViewModels"
             xmlns:models="clr-namespace:MyMauiApp.Models"
             x:Class="MyMauiApp.Pages.ProductListPage"
             x:DataType="viewmodels:ProductListViewModel"
             Title="Products">

    <ContentPage.Resources>
        <Style x:Key="ProductCard" TargetType="Frame">
            <Setter Property="CornerRadius" Value="10" />
            <Setter Property="Padding" Value="10" />
            <Setter Property="Margin" Value="5" />
            <Setter Property="HasShadow" Value="True" />
        </Style>
    </ContentPage.Resources>

    <Grid RowDefinitions="Auto,*">
        <!-- Search Bar -->
        <SearchBar Grid.Row="0"
                   Placeholder="Search products..."
                   Text="{Binding SearchQuery}"
                   SearchCommand="{Binding SearchCommand}" />

        <!-- Products List -->
        <RefreshView Grid.Row="1"
                     IsRefreshing="{Binding IsLoading}"
                     Command="{Binding LoadProductsCommand}">

            <CollectionView ItemsSource="{Binding Products}"
                            SelectionMode="Single"
                            SelectionChangedCommand="{Binding NavigateToDetailCommand}"
                            SelectionChangedCommandParameter="{Binding SelectedItem, Source={RelativeSource Self}}">

                <CollectionView.ItemsLayout>
                    <GridItemsLayout Orientation="Vertical"
                                     Span="{OnIdiom Phone=2, Tablet=3, Desktop=4}"
                                     VerticalItemSpacing="10"
                                     HorizontalItemSpacing="10" />
                </CollectionView.ItemsLayout>

                <CollectionView.ItemTemplate>
                    <DataTemplate x:DataType="models:Product">
                        <Frame Style="{StaticResource ProductCard}">
                            <VerticalStackLayout Spacing="5">
                                <Image Source="{Binding ImageUrl}"
                                       HeightRequest="150"
                                       Aspect="AspectFill" />
                                <Label Text="{Binding Name}"
                                       FontAttributes="Bold"
                                       FontSize="16"
                                       LineBreakMode="TailTruncation" />
                                <Label Text="{Binding Price, StringFormat='${0:F2}'}"
                                       TextColor="{StaticResource Primary}"
                                       FontSize="14" />
                                <Label Text="{Binding Category}"
                                       FontSize="12"
                                       TextColor="Gray" />
                            </VerticalStackLayout>
                        </Frame>
                    </DataTemplate>
                </CollectionView.ItemTemplate>

                <CollectionView.EmptyView>
                    <VerticalStackLayout VerticalOptions="Center"
                                         HorizontalOptions="Center">
                        <Label Text="No products found"
                               FontSize="18"
                               HorizontalTextAlignment="Center" />
                        <Button Text="Refresh"
                                Command="{Binding LoadProductsCommand}" />
                    </VerticalStackLayout>
                </CollectionView.EmptyView>
            </CollectionView>
        </RefreshView>

        <!-- Loading Indicator -->
        <ActivityIndicator Grid.RowSpan="2"
                           IsRunning="{Binding IsLoading}"
                           IsVisible="{Binding IsLoading}"
                           VerticalOptions="Center"
                           HorizontalOptions="Center" />
    </Grid>
</ContentPage>
```

## Platform-Specific Code

Handle platform differences:

```csharp
// Services/DeviceService.cs
namespace MyMauiApp.Services;

public partial class DeviceService
{
    public partial string GetDeviceId();
    public partial void ShowNativeNotification(string title, string message);
}

// Platforms/Android/DeviceService.cs
namespace MyMauiApp.Services;

public partial class DeviceService
{
    public partial string GetDeviceId()
    {
        return Android.Provider.Settings.Secure.GetString(
            Platform.CurrentActivity?.ContentResolver,
            Android.Provider.Settings.Secure.AndroidId) ?? "unknown";
    }

    public partial void ShowNativeNotification(string title, string message)
    {
        var context = Platform.CurrentActivity;
        if (context == null) return;

        var builder = new AndroidX.Core.App.NotificationCompat.Builder(context, "default")
            .SetContentTitle(title)
            .SetContentText(message)
            .SetSmallIcon(Resource.Drawable.notification_icon)
            .SetAutoCancel(true);

        var notificationManager = AndroidX.Core.App.NotificationManagerCompat.From(context);
        notificationManager.Notify(1, builder.Build());
    }
}

// Platforms/iOS/DeviceService.cs
namespace MyMauiApp.Services;

public partial class DeviceService
{
    public partial string GetDeviceId()
    {
        return UIKit.UIDevice.CurrentDevice.IdentifierForVendor?.ToString() ?? "unknown";
    }

    public partial void ShowNativeNotification(string title, string message)
    {
        var content = new UserNotifications.UNMutableNotificationContent
        {
            Title = title,
            Body = message,
            Sound = UserNotifications.UNNotificationSound.Default
        };

        var trigger = UserNotifications.UNTimeIntervalNotificationTrigger
            .CreateTrigger(1, false);

        var request = UserNotifications.UNNotificationRequest
            .FromIdentifier(Guid.NewGuid().ToString(), content, trigger);

        UserNotifications.UNUserNotificationCenter.Current
            .AddNotificationRequest(request, null);
    }
}
```

## Shell Navigation

Configure app navigation:

```csharp
// AppShell.xaml.cs
namespace MyMauiApp;

public partial class AppShell : Shell
{
    public AppShell()
    {
        InitializeComponent();

        // Register routes
        Routing.RegisterRoute(nameof(ProductDetailPage), typeof(ProductDetailPage));
        Routing.RegisterRoute(nameof(CartPage), typeof(CartPage));
        Routing.RegisterRoute(nameof(CheckoutPage), typeof(CheckoutPage));
    }
}
```

```xml
<!-- AppShell.xaml -->
<?xml version="1.0" encoding="UTF-8" ?>
<Shell xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
       xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
       xmlns:pages="clr-namespace:MyMauiApp.Pages"
       x:Class="MyMauiApp.AppShell"
       FlyoutBehavior="Flyout">

    <FlyoutItem Title="Products" Icon="products.png">
        <ShellContent Route="ProductList"
                      ContentTemplate="{DataTemplate pages:ProductListPage}" />
    </FlyoutItem>

    <FlyoutItem Title="Cart" Icon="cart.png">
        <ShellContent Route="Cart"
                      ContentTemplate="{DataTemplate pages:CartPage}" />
    </FlyoutItem>

    <FlyoutItem Title="Profile" Icon="profile.png">
        <ShellContent Route="Profile"
                      ContentTemplate="{DataTemplate pages:ProfilePage}" />
    </FlyoutItem>

    <MenuItem Text="Logout"
              IconImageSource="logout.png"
              Clicked="OnLogoutClicked" />
</Shell>
```

## Summary

.NET MAUI provides:

- Single project for all platforms
- Native performance and UI
- MVVM support with CommunityToolkit
- Hot reload for rapid development
- Platform-specific customization

MAUI is the evolution of Xamarin.Forms, making cross-platform development more accessible.


