---
name: Cognitive Architecture
colors:
  surface: '#fcf8ff'
  surface-dim: '#dcd9e0'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2fa'
  surface-container: '#f0ecf4'
  surface-container-high: '#eae7ef'
  surface-container-highest: '#e5e1e9'
  on-surface: '#1b1b21'
  on-surface-variant: '#474651'
  inverse-surface: '#303036'
  inverse-on-surface: '#f3eff7'
  outline: '#777682'
  outline-variant: '#c8c5d3'
  surface-tint: '#5654a8'
  primary: '#1a146b'
  on-primary: '#ffffff'
  primary-container: '#312e81'
  on-primary-container: '#9c9af4'
  inverse-primary: '#c3c0ff'
  secondary: '#555f6d'
  on-secondary: '#ffffff'
  secondary-container: '#d6e0f1'
  on-secondary-container: '#596372'
  tertiary: '#3e1a00'
  on-tertiary: '#ffffff'
  tertiary-container: '#5f2b00'
  on-tertiary-container: '#de915e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#100563'
  on-primary-fixed-variant: '#3e3c8f'
  secondary-fixed: '#d9e3f4'
  secondary-fixed-dim: '#bdc7d8'
  on-secondary-fixed: '#121c28'
  on-secondary-fixed-variant: '#3e4755'
  tertiary-fixed: '#ffdbc7'
  tertiary-fixed-dim: '#ffb688'
  on-tertiary-fixed: '#311300'
  on-tertiary-fixed-variant: '#70380b'
  background: '#fcf8ff'
  on-background: '#1b1b21'
  surface-variant: '#e5e1e9'
typography:
  display-lg:
    fontFamily: Rubik
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Rubik
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Rubik
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
  body-md:
    fontFamily: Rubik
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Rubik
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-xs:
    fontFamily: Rubik
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: Courier Prime
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  row-height-dense: 40px
  row-height-standard: 56px
  nav-width-expanded: 280px
  nav-width-collapsed: 64px
---

## Brand & Style
The design system is engineered for high-utility knowledge management, prioritizing cognitive clarity over decorative elements. It adopts a **Corporate / Modern** aesthetic, emphasizing structural integrity and high information density without sacrificing visual breathing room.

The system is designed with an **RTL-first (Right-to-Left)** mindset, ensuring that the visual hierarchy, directional icons, and navigation flow naturally for Hebrew-speaking users, while maintaining seamless legibility for inline LTR (English) content. The emotional response is one of reliability, order, and systematic efficiency.

- **Minimalism:** Heavy focus on functional white space to separate dense data sets.
- **Precision:** Fine lines and subtle tonal shifts replace heavy shadows to define boundaries.
- **Professionalism:** A disciplined use of color, where hue is strictly reserved for status communication and primary actions.

## Colors
This design system utilizes a structured palette designed for enterprise accessibility (WCAG 2.1 AA compliance).

- **Primary (Deep Indigo):** Reserved exclusively for high-intent actions, primary buttons, and active navigation states.
- **Neutral Palette:** Employs a range of cool grays. Surfaces use the lightest tints to distinguish between the background and container layers.
- **Semantic Status:** 
    - **Blue (Queued):** Indicates an item is in the pipeline.
    - **Yellow (Processing):** Indicates active computation or ingestion.
    - **Green (Indexed):** Indicates successful completion and searchability.
    - **Red (Failed):** Indicates a terminal error requiring user intervention.

## Typography
The system uses **Rubik** as the primary typeface. It was selected for its exceptional legibility in Hebrew (RTL) and its friendly yet professional geometric construction in English (LTR).

- **Hierarchy:** Use `display-lg` for dashboard overviews and `headline-md` for folder titles. 
- **Body Text:** `body-md` is the standard for document descriptions; `body-sm` is used for metadata and row items to increase data density.
- **Language Handling:** Ensure `line-height` remains generous (minimum 1.5x for body) to accommodate Hebrew diacritics without clipping. For technical metadata or IDs, use the secondary monospaced font.

## Layout & Spacing
The layout follows a **Fixed-Fluid hybrid model**. The sidebar navigation is fixed-width (collapsible), while the content area expands to fill the viewport.

- **RTL Alignment:** In Hebrew mode, the navigation tree resides on the right, and the content flows to the left. Breadcrumbs must reverse their chevron direction (`> ` becomes ` <`).
- **Data Density:** Use the `row-height-dense` setting for file explorers and document lists to maximize the number of visible items above the fold.
- **Breakpoints:** 
    - **Desktop (1280px+):** Full navigation tree visible.
    - **Tablet (768px - 1279px):** Navigation tree collapses to icons.
    - **Mobile (<767px):** Navigation moves to a bottom-sheet or full-screen overlay; margins reduce to 16px.

## Elevation & Depth
This design system avoids heavy shadows in favor of **Tonal Layering** and **Low-Contrast Outlines**. Depth is used to indicate modularity, not physical height.

- **Level 0 (Background):** Gray-50. The canvas upon which everything sits.
- **Level 1 (Surface):** White. Used for the main content area, cards, and the navigation tree. Defined by a 1px border in Gray-200.
- **Level 2 (Overlays):** Subtle ambient shadow (Y: 4px, Blur: 12px, 5% Black). Used for dropdown menus, tooltips, and modals to separate them from the document grid.
- **Interactions:** On hover, document rows transition from White to Gray-50 to provide immediate feedback without shifting elevation.

## Shapes
The shape language is **Soft**, utilizing small corner radii to maintain a professional, organized appearance while avoiding the harshness of sharp corners.

- **Components:** Buttons and input fields use 4px (`rounded`) corners.
- **Containers:** Modals and large cards use 8px (`rounded-lg`) corners.
- **Status Chips:** Use a fully rounded pill shape to distinguish them from interactive buttons.

## Components
- **Navigation Tree:** A hierarchical, collapsible list. Active items use a Deep Indigo right-border (in RTL) and a light Indigo tint for the background.
- **Document Rows:** Each row includes a file-type icon, title, "Last Modified" date, and a semantic status chip.
- **Status Chips:** Small, pill-shaped indicators. They use a high-contrast background (e.g., Green-100 background with Green-900 text) and a leading 8px dot or micro-icon for accessibility.
- **Buttons:** 
    - *Primary:* Deep Indigo background, white text.
    - *Secondary:* White background, Gray-300 border, Gray-700 text.
- **Breadcrumbs:** Located above the page title. Use "/" as a separator in LTR and a mirrored chevron in RTL.
- **Skeletons:** Use a soft "pulse" animation. Skeletons should mirror the exact height of document rows and chip components to prevent layout shift during loading.
- **Empty States:** Centered illustration (subtle line art), a `title-sm` heading, and a single primary CTA button to "Upload Document" or "Create Folder."