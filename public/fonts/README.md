# 🎨 Custom Font Directory

Place your custom font files (`.woff2`, `.woff`, `.ttf`, or `.otf`) in this folder (`public/fonts/` or `public/font/`).

## 📁 Recommended File Naming
For automatic default system integration, you can name your font files as:
* **Regular**: `custom-font.woff2`, `custom-font.ttf`, `custom-font.woff`, or `custom-font.otf`
* **Bold**: `custom-font-bold.woff2`, `custom-font-bold.ttf`, `custom-font-bold.woff`, or `custom-font-bold.otf`
* **Italic**: `custom-font-italic.woff2`, `custom-font-italic.ttf`, etc.

## ⚙️ How It Works
The system is pre-configured with `@font-face` rules in `src/styles.css` that prioritize `CustomFont` (from this directory) as the **primary default font** across the entire application (Headings, Body, Inputs, PrimeNG components, Material UI, and Tailwind). If no custom font file is placed here, it automatically falls back to `Kantumruy Pro` and `Inter`.
