# Design System Specification: The Architectural Console

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Atrium"**
This design system moves away from the cluttered, industrial aesthetic typical of logistics software, instead adopting the poise of high-end architectural visualization. It treats the food plant logistics console not as a tool, but as a command center of light and glass. 

We achieve a "High-End Editorial" feel by balancing extreme technical precision with ethereal depth. The layout breaks the traditional rigid grid through **intentional asymmetry**—using wide gutters and varying column widths to guide the eye toward critical data points. The interface should feel like it is projected onto a pane of glass in a light, sophisticated environment.

---

## 2. Colors: Tonal Depth & Luminous Accents
Our palette is rooted in the clarity of the day, using light slates to provide a stable foundation for luminous data overlays.

### The Foundation
*   **Background / Surface:** `#0B1326` (neutral_color_hex) – A deep, void-like slate that creates the "Atrium" environment.
*   **Primary (Ethereal Blue):** `#8ED5FF` (primary_color_hex) – Used for active states and critical path highlights.
*   **Tertiary (Refined Emerald):** `#56E5A9` (tertiary_color_hex) – Reserved exclusively for "Success" or "Optimal Flow" status. It must feel like a glowing jewel against the dark slate.

### The "No-Line" Rule
Traditional 1px solid borders for sectioning are strictly prohibited. Boundaries must be defined through **Background Shifting**. 
*   Place a `surface-container-low` (`#131B2E`) section directly onto the `background` to define a workspace.
*   Use `surface-container-highest` (`#2D3449`) to draw attention to active utility panels.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers.
1.  **Level 0 (Background):** `#0B1326` (The base)
2.  **Level 1 (The Floor):** `surface-container-low` (`#131B2E`) for main content areas.
3.  **Level 2 (The Floating Pane):** `surface-container-high` (`#222A3D`) for interactive modules.

### The Glass & Gradient Rule
To achieve the "High-Tech" keyword, use **Glassmorphism** for floating overlays (modals, tooltips, dropdowns). 
*   **Formula:** `surface-container` color at 60% opacity + 20px Backdrop Blur.
*   **Signature Texture:** Main CTAs should use a linear gradient from `primary` (`#8ED5FF`) to `primary-container` (`#38BDF8`) at a 135-degree angle to provide a sense of illuminated volume.

---

## 3. Typography: Technical Elegance
The contrast between the geometric rigidity of **Space Grotesk** and the functional clarity of **Inter** creates a sophisticated, data-driven hierarchy.

*   **Display & Headlines (Space Grotesk):** These are your architectural anchors. Use `display-lg` and `headline-md` with a `+0.05em` letter-spacing. This "breathing room" communicates luxury and precision.
*   **Titles & Body (Inter):** The workhorse. Maintain tight leading for data density, but ensure `body-lg` is used for narrative descriptions to keep the "Editorial" feel.
*   **Labels (Inter):** Use `label-md` and `label-sm` in `on-surface-variant` (`#BDC8D1`) for metadata. These should be treated like technical annotations on a blueprint.

---

## 4. Elevation & Depth: Tonal Layering
We do not use drop shadows to communicate "cheap" lift. We use **Tonal Layering** and **Ambient Light**.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface-container-lowest` card placed on a `surface-container-low` background creates a "sunken" precision look.
*   **Ambient Shadows:** For floating elements (like a logistics route detail), use a wide-spread shadow: `0px 24px 48px rgba(0, 0, 0, 0.4)`. The shadow must feel like it belongs to the light environment, not like a black smudge.
*   **The "Ghost Border" Fallback:** If containment is needed (e.g., in complex data tables), use a 1px border of `outline-variant` (`#3E484F`) at **15% opacity**. It should be felt, not seen.
*   **Inner Glow:** For primary interactive elements, apply a subtle `1px` inner shadow (0px 1px 2px) using `on-primary-fixed` at 20% opacity to mimic light hitting the edge of a glass pane.

---

## 5. Components: Precision Modules

### Buttons
*   **Primary:** Gradient fill (`primary` to `primary-container`), moderate `8px` (DEFAULT roundedness 2) corners. No border. White text (`on-primary`).
*   **Secondary:** Ghost style. `1px` border of `primary` at 30% opacity. On hover, increase opacity to 100%.
*   **Tertiary:** Text only, `letter-spacing: 0.08em`, all caps for a "Navigation" feel.

### Cards & Lists
*   **Execution:** Forbid the use of divider lines. Separate logistics entries using a `16px` vertical gap (Spacing Scale) or by alternating background tones between `surface-container-low` and `surface-container-lowest`.
*   **Interactive State:** On hover, a card should transition its background to `surface-bright` (`#31394D`) and add a `1px` inner glow.

### Input Fields
*   **State:** Use `surface-container-lowest` for the field fill. 
*   **Bottom-Line Only:** To maintain the architectural feel, use a 1px bottom border of `outline` (`#87929A`) instead of a full box. This mimics a "ledger" or "blueprint" line.

### Logistics-Specific Components
*   **Status Beacons:** Instead of a simple dot, use a small emerald (`tertiary`) circle with a 4px soft outer glow (pulse animation) to indicate a "Live" facility line.
*   **The Telemetry Chip:** Small, high-contrast chips using `surface-container-highest` with `label-sm` text. Use these for temperature readings or truck IDs.

---

## 6. Do’s and Don’ts

### Do:
*   **Use Normal Spacing:** Treat space with purpose. Data is dense; the UI around it must be clear and readable.
*   **Embrace Moderate Roundedness:** Use `8px` (DEFAULT) corner radius for most elements to provide a refined, professional look.
*   **Align to the Baseline:** Ensure all typography sits on a strict 4px grid to maintain "Precision."

### Don’t:
*   **Don't use 100% Opacity Borders:** They break the "Glassmorphism" and feel like a standard template.
*   **Don't use Excessive Rounded Corners:** This is a professional logistics tool, not a consumer social app. Avoid "friendly" roundness that exceeds moderate rounding.
*   **Don't use Pure Black:** Always use the deep slate `background` (`#0B1326`) to ensure the blues and emeralds feel "ethereal" rather than "neon."