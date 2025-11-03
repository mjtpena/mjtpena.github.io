# Microsoft Fabric Green Theme

This blog now features a comprehensive Microsoft Fabric-inspired design system with signature green accents.

## Color Palette

### Light Mode
- **Primary Green**: `#107C10` - Main brand color, buttons, accents
- **Green Hover**: `#0E700E` - Interactive hover states
- **Green Pressed**: `#0C5E0C` - Active/pressed states
- **Green Light**: `#DFF6DD` - Backgrounds, highlights
- **Green Lighter**: `#F0FBF0` - Subtle backgrounds

### Dark Mode
- **Primary Green**: `#7FBA00` - Brighter green for dark backgrounds
- **Green Hover**: `#8BC700` - Dark mode hover
- **Green Pressed**: `#6FAC00` - Dark mode pressed
- **Green Light**: `#1A3A0A` - Dark backgrounds
- **Green Lighter**: `#0F2205` - Subtle dark backgrounds

### Supporting Colors
- **Blue**: `#0078D4` - Secondary actions, links (in some contexts)
- **Warning**: `#F7630C` / `#FCE100` (dark)
- **Error**: `#D13438` / `#F1707B` (dark)

## Key Design Elements

### 1. **Green Accent Borders**
- Post cards have a 3px left border that turns green on hover
- H1 headings feature a 4px green left border
- Post headers have a 2px green bottom border
- Footer has a 2px green top border

### 2. **Primary Actions**
All primary buttons use Fabric green:
- Profile buttons
- "View all posts" action
- Pagination buttons
- Primary CTAs

### 3. **Interactive Elements**
Green hover states on:
- Navigation menu items (active state)
- Post entry cards (border highlight)
- Tags (background changes to green)
- Search results (left border accent)
- Table of Contents links
- Share buttons

### 4. **Focus States**
Accessibility focus rings use Fabric green for keyboard navigation

### 5. **Text Selection**
Selected text highlights in green (light green background with green text)

### 6. **Links**
Content links use green color with underline on hover

### 7. **Status Indicators**
- Success messages: Green left border with light green background
- Warning messages: Orange/yellow accent
- Error messages: Red accent

### 8. **Profile**
Profile image has a 3px green border ring

## Layout Improvements

### Microsoft Fabric Grid System
- Responsive 3-column grid for Recent Posts (mobile: 1 col, tablet: 2 col, desktop: 3 col)
- Consistent 24px gap spacing
- Fluent shadow elevation system (2, 4, 8, 16, 64 levels)

### Card Design
- Subtle elevation with shadow-2
- Hover: translateY(-2px) with shadow-8
- Green left border accent on hover
- 4px border-radius (Fabric standard)

### Typography
- Segoe UI for body text
- Cascadia Code for code blocks
- Font weight hierarchy: 400 (normal), 600 (semibold)
- Letter-spacing: -0.01em for headings

### Spacing
- Section gaps: 24px-48px
- Content gap: 20px
- Card padding: 16px-20px
- Button padding: 10px 20px

## Navigation
- Acrylic blur effect (backdrop-filter)
- Green active state for current page
- Green hover state for menu items
- Smooth transitions (0.1s cubic-bezier)

## Accessibility Features
- 2px green focus outlines with 2px offset
- Sufficient color contrast ratios
- Smooth scroll behavior
- 64px scroll-margin-top for anchored headings
- Skip to content link in green

## Dark Mode
All green tokens automatically adapt to dark mode with brighter, more vibrant greens (#7FBA00) for better contrast on dark backgrounds.

## Browser Support
- Modern browsers with CSS custom properties support
- Backdrop-filter for supported browsers (fallback to solid background)
- Progressive enhancement approach

---

**Note**: This design system follows Microsoft Fabric's principles while maintaining the flexibility of Hugo's PaperMod theme. The green accent color (#107C10) is Microsoft's signature success/growth color used throughout the Fabric design language.
