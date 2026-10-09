# Shadcn-UI Template Usage Instructions

## technology stack

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

All shadcn/ui components have been downloaded under `@/components/ui`.

## File Structure

- `index.html` - HTML entry point
- `vite.config.ts` - Vite configuration file
- `tailwind.config.ts` - Tailwind CSS configuration file
- `package.json` - NPM dependencies and scripts
- `src/main.tsx` - Project entry point
- `src/App.tsx` - Router shell (imports pages and sets up routes)
- `src/pages/Index.tsx` - Main page entry point for `/` by default; replace the placeholder page here unless you explicitly reroute `/` elsewhere
- `src/index.css` - Existing CSS configuration

## Components

- All shadcn/ui components are pre-downloaded and available at `@/components/ui`

## Styling

- Add global styles to `src/index.css` or create new CSS files as needed
- Use Tailwind classes for styling components

## Design workflow

For a new frontend, create `DESIGN.md` before writing application code:

1. If `DESIGN.md` already exists, read and follow it instead of overwriting it.
2. Otherwise, derive the design from the original requirement and supplied theme or references. Use the workspace-relative path `DESIGN.md`, without another design file.
3. Keep the design concise without omitting concrete, requirement-specific visual decisions. Do not spend tool calls counting tokens.
4. Implement the smallest complete product using this specification. Do not reread a file you just wrote unless exact text is needed later.

### Design principles

**DESIGN.md turns vague aesthetic preferences into concrete constraints the Agent can implement.**

- Color sets the mood, typography sets the voice, radii define the shape language, components enable reuse, layout establishes rhythm, and do/don't rules keep the design on course.
- **Precision and control improve visual quality.** Specify HEX colors, pixel values, font weights, radii, and spacing rhythms so the implementation is attractive and consistent.
- Good design comes from **coordinated choices** across color, type, spacing, radii, and hierarchy. Decide what the product should and should not feel like before specifying individual elements; adding features is not a substitute.

### Be bold, creative, and distinctive

**Pursue a recognizable visual identity.** Make confident, memorable choices without sacrificing usability or accessibility:

1. **Choose expressive colors**: Go beyond neutral gray with a small primary-color accent. Select a palette with mood and identity: saturated contrasts, large areas drenched in brand color, or carefully tuned warm/cool neutrals with an unexpected accent. Provide a complete color scale while maintaining contrast and a 60/30/10 visual balance.
2. **Choose typography deliberately**: Avoid reflexively picking overused safe fonts such as Inter or default serif display faces. Match the product's voice with fonts that have distinctive x-heights, stroke contrast, or terminals; headings may use a strong display face. Name specific web fonts that can be loaded for free.
3. **Give the layout a point of view**: Do not default to centered stacks of cards. Consider asymmetric compositions (70/30 or 80/20 columns), rhythmic whitespace, one dominant visual per screen, or an explicit Swiss/brutalist grid. Give the hero a clear visual statement instead of an undistinguished centered column.
4. **Avoid generic AI aesthetics without overcorrecting**:
   - Avoid these overused defaults: dark backgrounds with blue-purple gradients, cards with colored left borders, excessive glassmorphism, or warm beige with serif headings and spacious editorial layouts applied to every product.
   - These are **not absolute bans**. If the industry or context calls for a style, use it and explain in `Direction & Layout` why it fits this specific product. A space or technology product may suit a cool dark palette; a literary magazine may suit beige and serifs. Avoid choices made by default without a reason.
   - **For blue, indigo, or purple primary palettes**, avoid the generic AI-product look: Orbitron/Exo/Rajdhani-style technology fonts, glowing or gradient-bordered cards, and dashboard layouts combining icon grids with monospace type. These colors can instead feel academic, oceanic, nocturnal, luxurious, or calmly restrained.

**Bold choices must form a coherent system**: colors, type, spacing, and radii should work together and follow the product's industry, audience, and mood. Do not add effects merely to show off. Preserve usability, readability, and accessibility.

### Let the product determine the style

Before writing the specification, choose an **explicit visual direction** and record it in `Direction & Layout`:

1. **Use the industry and context to guide the emphasis**. These examples illustrate the reasoning; do not copy them mechanically:
   - Finance / trading / data tools: high information density, calm restraint, possibly dark or neutral colors, sans-serif type, minimal decoration.
   - Developer tools / technical communities: monospace accents, clear contrast, function first, possibly a dark palette.
   - Children / games / education: saturated colors, rounded forms, playful illustrations, expressive motion.
   - Luxury / fashion: strong contrast, large imagery, minimalism, possibly pure black and white.
   - Travel / lifestyle / content: photography-led, warm, potentially editorial.
   - Marketing landing pages: a strong hero, distinctive primary color, conversion-focused hierarchy.
2. **Do not assume a background palette**: pure white, warm white, cool gray, dark colors, brand colors, gradients, and imagery are all candidates. Choose based on the product's character.
3. **Do not assume a type category**: serif, grotesk, geometric sans, humanist sans, mono, and display are all candidates. Choose based on the product's voice.
4. Ask: **"Would this DESIGN.md still fit if I replaced the product name with one from a completely different industry?"** If so, it is too generic; revise it to make the decisions specific to this product.

Specify concrete HEX values, font sizes/weights/line heights, spacing, radii, and relevant motion duration/easing rather than aesthetic adjectives alone.

### Required DESIGN.md structure

Use the following four sections with `##` headings. Cover every category below with concrete, product-specific decisions; briefly explain anything that does not apply. Record each decision once and reference shared tokens. Do not add alternatives, requirement recaps, tutorials, code samples, or repeated page-by-page specifications.

- `Direction & Layout`:
  - Define the product's purpose, mood, first visual signal, and what it should and should not feel like. Name one defining visual idea implemented in the first screen and one concrete visual reference (supplied first; never claim to have inspected an unopened reference).
  - Specify the focal point, information hierarchy, hero composition, maximum content width, grid columns, content density, section spacing, card gaps, and whitespace rhythm. Give brand surfaces identity while keeping operational controls and product comparisons predictable.
  - Define mobile/tablet/desktop breakpoints and how the hero, navigation, and grids rearrange, padding changes, and image ratios adapt.
  - Include explicit do/don't rules: required visual features, prohibited colors or usages, unacceptable component substitutions, and layouts or generic AI styles to avoid for this product.
- `Tokens`:
  - Colors: provide HEX values and semantic uses for primary/accent colors, backgrounds, surface layers, text hierarchy, and status colors. State where accents should remain scarce and include light/dark variants only when applicable.
  - Typography: name available, freely loadable fonts with fallbacks and describe their character. Specify font family, size, weight, and line height for headings, body text, buttons, and captions, including display scale and text density.
  - Spacing and shapes: define the spacing scale and concrete radii for required buttons, cards, images, and inputs; state whether icon buttons are circular and describe the overall shape language.
  - Elevation and depth: define how borders, shadows, color blocks, blur, or glass effects establish hierarchy. Give applicable border/shadow values and layering rules for overlays and sticky elements.
- `Shared Patterns & States`:
  - List only the core reusable components and layouts this product needs. For each, define its purpose, meaningful variants, background, typography, radius, padding, border/shadow, and prohibited misuse by referring to shared tokens.
  - Specify applicable hover, active, disabled, loading, empty, and error states and required interactions. Do not invent components or states merely to fill a checklist.
  - Motion: define its intensity, duration, and easing, how required hover/press, accordion, carousel, or reveal interactions move, and where motion is inappropriate. Keep primary content visible on initial render, including when scrolling or animation scripts do not run.
  - Accessibility: specify minimum click/tap target sizes, contrast requirements, focus-ring styling, keyboard navigation, accessible names for icon buttons, and form error feedback where applicable.
- `Media`:
  - Plan relevant imagery for visually led pages even without an explicit image request. State whether real imagery is essential and choose photography, illustration, 3D, screenshots, avatars, or data graphics as appropriate. Explicitly state whether abstract gradients or SVG substitutes are acceptable.
  - Record each needed asset's purpose, source, style, aspect ratio/crop, placement, full-bleed behavior, and text-overlay constraints; reuse shared direction rather than duplicating long descriptions.
  - Respect supplied designs/assets, prioritize the main visual, and choose quantity by content needs, not a fixed quota. Generate missing assets with the `image-generation` Skill and use the completed assets; verify references and placement before delivery. Operational interfaces may briefly explain why imagery is unnecessary.

Keep all requested capabilities and their necessary implementation details, but do not add routes, features, entities, controls, or files merely to make the product seem more complete. Reuse patterns with data/configuration; do not replace required differences with generic placeholders.

Primary content must be visible on initial render; do not depend on scrolling or `IntersectionObserver` to remove default `opacity: 0` or `visibility: hidden` states. In the existing validation pass, check the first-screen focal point, defining idea, usability, and mobile hierarchy. Fix concrete mismatches without adding a separate design-review loop or claiming unperformed visual checks.

## Development

- Import components from `@/components/ui` in your React components
- Customize the UI by modifying the Tailwind configuration
- Do not stop after editing isolated components or only `src/App.tsx`. The default template homepage lives in `src/pages/Index.tsx`, and leaving `Welcome to Atoms` there means the app is still unfinished.
- Completion check: either replace `src/pages/Index.tsx` with your real homepage, or update the `/` route in `src/App.tsx` so the live homepage no longer renders the default placeholder page.

### Hot updates

`plugins/react-hmr-guard.ts` uses Vite's development hooks to reload the page when
component names, export bindings, or wrapper/declaration types change. This avoids
stale React Refresh boundaries without patching `@vitejs/plugin-react-swc`.
These structural changes reset page state; ordinary component body edits continue
through Fast Refresh. The guard does not run in production builds.

## Note

- The `@/` path alias points to the `src/` directory
- Do NOT modify the title, description, and logo in `index.html` — they are managed by the overview system via `data-mgx-overview` markers.
- Do not design or generate browser favicon assets for ordinary development or branding requests. Only do so when the user explicitly asks for favicon customization or provides an image for that purpose; this does not restrict in-page brand logo design.

# Commands

**Install Dependencies**

```shell
pnpm i
```

**Start Preview**

```shell
pnpm run dev
```

**To build**

```shell
pnpm run build
```
