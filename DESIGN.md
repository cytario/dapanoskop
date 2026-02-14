# Cytario Design Guide

## Color Scheme

### Brand Colors

| Token | Hex | Usage |
|---|---|---|
| `cytario-purple` | `#663399` | Primary brand color, gradients |
| `cytario-purple-dark` | `#4a2470` | Gradient endpoints, dark accents |
| `cytario-purple-light` | `#8855bb` | Light purple accents |
| `cytario-teal` | `#4dd0e1` | Secondary brand accent |
| `cytario-teal-dark` | `#26a69a` | Dark teal variant |
| `cytario-teal-light` | `#80e5ff` | Light teal variant |

### Primary Palette (Purple)

Used for buttons, links, interactive elements, and key UI accents.

| Token | Hex |
|---|---|
| `primary-50` | `#faf7ff` |
| `primary-100` | `#f3ebff` |
| `primary-200` | `#e9d5ff` |
| `primary-300` | `#d8b4fe` |
| `primary-400` | `#c084fc` |
| `primary-500` | `#a855f7` |
| `primary-600` | `#9333ea` |
| `primary-700` | `#7e22ce` |
| `primary-800` | `#6b21a8` |
| `primary-900` | `#581c87` |

**`primary-600`** (`#9333ea`) is the workhorse -- used for CTA buttons, hover states, announcement bars, tags, and active navigation links.

### Secondary Palette (Teal)

Used sparingly for decorative background elements.

| Token | Hex |
|---|---|
| `secondary-50` | `#f0fdfa` |
| `secondary-100` | `#ccfbf1` |
| `secondary-200` | `#99f6e4` |
| `secondary-300` | `#5eead4` |
| `secondary-400` | `#2dd4bf` |
| `secondary-500` | `#14b8a6` |
| `secondary-600` | `#0d9488` |
| `secondary-700` | `#0f766e` |
| `secondary-800` | `#115e59` |
| `secondary-900` | `#134e4a` |

### Gradients

| Name | Definition |
|---|---|
| `cytario-gradient` | `linear-gradient(135deg, #663399 0%, #4a2470 100%)` |
| `cytario-gradient-reverse` | `linear-gradient(135deg, #4a2470 0%, #663399 100%)` |

## Typography

- **Font family:** Montserrat (headings + body), with `system-ui, sans-serif` fallback
- **Weights:** 200 (extra-light) through 900 (black)
- **Body text color:** `rgb(55, 65, 81)` (Tailwind `gray-700`)
- **Heading text color:** `rgb(17, 24, 39)` (Tailwind `gray-900`)

## Common Patterns

- **CTA buttons:** `bg-primary-600 text-white hover:bg-primary-700` with rounded-lg
- **Ghost buttons:** `border-2 border-gray-200 hover:border-primary-600 hover:text-primary-600`
- **Link hover:** `text-gray-600 hover:text-primary-600`
- **Tags/badges:** `text-primary-600 bg-primary-50 rounded-full`
- **Featured cards:** `border-primary-600 ring-2 ring-primary-600`
