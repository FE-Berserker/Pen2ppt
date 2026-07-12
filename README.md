# Pen2ppt

将 Pencil (`.pen`) 设计稿转换为**可编辑的 PowerPoint (`.pptx`)** 演示文稿。
Convert Pencil (`.pen`) designs into **editable PowerPoint (`.pptx`)** decks.

[中文](#中文) | [English](#english)

---

## 中文

### 项目简介

Pen2ppt 打通 `.pen → HTML → PPTX` 的完整转换链路：

1. **Pencil → HTML**：通过 Pencil MCP 的 `export_html` 工具，将 `.pen` 文件中的每个顶层 Frame（即 Slides 面板中的每一页）导出为独立的 HTML 文件；
2. **HTML 拼接**：用脚本把多个单页 HTML 拼接成一个包含多个 `<section class="slide">` 的 `combined.html`；
3. **HTML → PPTX**：借助无头 Chromium + [dom-to-pptx](https://www.npmjs.com/package/dom-to-pptx) 将 HTML 渲染为 `.pptx`。

转换结果中，**文本保持为真实可编辑的文字**，纯色矩形/椭圆保留为原生形状，渐变/模糊等复杂效果则栅格化为图片以保证视觉还原。

### 核心特性

- ✅ **文本可编辑**：导出的 PPTX 中文字可以直接在 PowerPoint 里选中修改，不是截图
- ✅ **固定 16:9 页面**：画布默认为 13.333×7.5 in（1280×720），已是 16:9 的页面 1:1 原生放置
- ✅ **非 16:9 页面自动适配**：contain-fit 等比缩放居中，留黑边（letterbox），**不拉伸、不裁剪**，并会在报告中提示哪些页面被适配
- ✅ **图片填充保留**：图片填充以图片形式嵌入，裁剪/覆盖方式不变
- ✅ **不改动原始 `.pen`**：所有尺寸转换都发生在 HTML→PPTX 阶段，源文件只读

### 仓库结构

```
Pen2ppt/
├── Custom_ppt_template.pen        # 示例 Pencil 设计文件（PPT 模板）
├── exports/                       # 转换输出目录
│   └── Custom_ppt_template.pptx   # 已生成的示例 PPTX
└── .claude/skills/pen2ppt/        # 转换流水线（Claude Code skill）
    ├── SKILL.md                   # 技能说明与完整使用流程
    ├── package.json               # 依赖：dom-to-pptx（自带 puppeteer + Chromium）
    └── scripts/
        ├── build-combined.mjs     # 拼接多个单页 HTML → combined.html
        └── export-pptx.mjs        # 无头 Chromium + dom-to-pptx → .pptx
```

### 快速开始

#### 安装 Skill

Skill 本体位于本仓库的 [.claude/skills/pen2ppt/](.claude/skills/pen2ppt/) 目录。要在自己的项目中使用，将该目录复制到目标项目的 `.claude/skills/` 下：

```bash
# 在目标项目根目录执行（<pen2ppt-repo> 为本仓库路径）
mkdir -p .claude/skills
cp -r <pen2ppt-repo>/.claude/skills/pen2ppt .claude/skills/

# 安装依赖（自带 Chromium，用于无头渲染）
cd .claude/skills/pen2ppt
npm install
```

Windows (PowerShell)：

```powershell
New-Item -ItemType Directory -Force .claude\skills
Copy-Item -Recurse <pen2ppt-repo>\.claude\skills\pen2ppt .claude\skills\
cd .claude\skills\pen2ppt
npm install
```

#### 前置条件

- Node.js
- 目标项目中有待转换的 `.pen` 文件，且已配置 Pencil MCP（提供 `export_html` 工具）
- 转换时需要联网（Tailwind 与字体在渲染时从 CDN 加载；离线时字体回退到系统字体，布局不受影响）

#### 使用方式

本项目以 Claude Code Skill 的形式工作。在 Claude Code 中直接提出需求即可，例如：

> "把这个 .pen 文件导出成 PPT"
> "只要封面和目录两页，输出为 intro.pptx"
> "用 1920×1080 的尺寸导出"

流水线会自动完成：读取顶层 Frame → 逐页 `export_html` → 拼接 → 渲染 PPTX → 报告输出路径、页数及非 16:9 页面的适配提示。

也可以手动运行脚本：

```bash
cd .claude/skills/pen2ppt

# 1. 拼接（按幻灯片顺序传入各页 HTML）
node scripts/build-combined.mjs --out ../../exports/combined.html \
  ../../exports/slide-01.html ../../exports/slide-02.html

# 2. 渲染为 PPTX（固定 16:9；可用 --width/--height 指定其他 16:9 尺寸）
node scripts/export-pptx.mjs ../../exports/combined.html \
  -o ../../exports/deck.pptx --selector .slide
```

### 还原度说明

| 内容类型 | 导出效果 |
|---|---|
| 文本 | 真实可选中编辑的文字 |
| 纯色矩形/椭圆、基础布局 | PPTX 原生形状 |
| CSS 渐变、`filter: blur()`、部分变换 | 栅格化为图片（外观一致，不可矢量编辑） |
| 图片填充 | 以图片嵌入，crop/cover 保留 |
| 非 16:9 页面 | letterbox 留边，绝不拉伸或裁剪 |

### 常见问题

- **无头浏览器启动失败 / 错误地使用了 Edge**：务必使用 `scripts/export-pptx.mjs`（已处理 `dom-to-pptx@2.0.3` 与 `puppeteer@25` 的兼容问题）；仍失败可用 `--browser "C:/path/to/chrome.exe"` 指定浏览器。
- **PPTX 中图片丢失**：本地图片会在渲染前内联为 base64（避免 `file://` 污染 canvas）；若仍缺失，检查图片路径是否相对于 combined HTML 可解析。
- **页面出现空白边**：这是非 16:9 页面 contain-fit 的预期行为；在 Pencil 中将该页改为 16:9 即可全幅铺满。
- **PowerPoint 中文字不可编辑**：确认使用的是 `export-pptx.mjs`，且源 HTML 中是真实文本节点而非被拍平的图片。

更多细节见 [.claude/skills/pen2ppt/SKILL.md](.claude/skills/pen2ppt/SKILL.md)。

---

## English

### Introduction

Pen2ppt closes the full `.pen → HTML → PPTX` conversion loop:

1. **Pencil → HTML**: via the Pencil MCP `export_html` tool, each top-level frame of the `.pen` file (i.e. every entry in the Slides panel) is exported to a standalone HTML file;
2. **HTML stitching**: a script combines the per-frame HTML files into one `combined.html` containing multiple `<section class="slide">` elements;
3. **HTML → PPTX**: headless Chromium + [dom-to-pptx](https://www.npmjs.com/package/dom-to-pptx) renders the HTML into a `.pptx`.

In the output, **text stays as real, editable text**, solid-color rectangles/ellipses remain native shapes, and complex effects like gradients/blur are rasterized to images to preserve visual fidelity.

### Features

- ✅ **Editable text**: text in the exported PPTX can be selected and edited directly in PowerPoint — it's not a screenshot
- ✅ **Fixed 16:9 pages**: the deck defaults to 13.333×7.5 in (1280×720); slides that are already 16:9 are placed 1:1 native
- ✅ **Non-16:9 slides auto-fitted**: contain-fit (uniformly scaled, centered, letterboxed) — **never stretched or cropped**, with a report of which slides were fitted
- ✅ **Image fills preserved**: image fills embed as pictures with crop/cover intact
- ✅ **Original `.pen` untouched**: all size conversion happens in the HTML→PPTX step; the source file is read-only

### Repository Structure

```
Pen2ppt/
├── Custom_ppt_template.pen        # Sample Pencil design file (PPT template)
├── exports/                       # Conversion output directory
│   └── Custom_ppt_template.pptx   # Generated sample PPTX
└── .claude/skills/pen2ppt/        # Conversion pipeline (Claude Code skill)
    ├── SKILL.md                   # Skill docs and full workflow
    ├── package.json               # Dependency: dom-to-pptx (bundles puppeteer + Chromium)
    └── scripts/
        ├── build-combined.mjs     # Stitch per-frame HTML files → combined.html
        └── export-pptx.mjs        # Headless Chromium + dom-to-pptx → .pptx
```

### Quick Start

#### Installing the Skill

The skill lives in this repo at [.claude/skills/pen2ppt/](.claude/skills/pen2ppt/). To use it in your own project, copy that directory into your project's `.claude/skills/` folder:

```bash
# Run from your project root (<pen2ppt-repo> = path to this repo)
mkdir -p .claude/skills
cp -r <pen2ppt-repo>/.claude/skills/pen2ppt .claude/skills/

# Install dependencies (bundles Chromium for headless rendering)
cd .claude/skills/pen2ppt
npm install
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force .claude\skills
Copy-Item -Recurse <pen2ppt-repo>\.claude\skills\pen2ppt .claude\skills\
cd .claude\skills\pen2ppt
npm install
```

#### Prerequisites

- Node.js
- A `.pen` file to convert in your project, with Pencil MCP configured (provides the `export_html` tool)
- Internet access during conversion (Tailwind and fonts load from CDN at render time; offline, fonts fall back to system fonts but layout survives)

#### Usage

This project works as a Claude Code skill. Just ask in Claude Code, e.g.:

> "Export this .pen file to PowerPoint"
> "Only the cover and agenda slides, output as intro.pptx"
> "Export at 1920×1080"

The pipeline automatically: reads top-level frames → `export_html` per frame → stitches → renders PPTX → reports the output path, slide count, and any non-16:9 fitting warnings.

You can also run the scripts manually:

```bash
cd .claude/skills/pen2ppt

# 1. Stitch (pass per-frame HTML files in slide order)
node scripts/build-combined.mjs --out ../../exports/combined.html \
  ../../exports/slide-01.html ../../exports/slide-02.html

# 2. Render to PPTX (fixed 16:9; use --width/--height for other 16:9 sizes)
node scripts/export-pptx.mjs ../../exports/combined.html \
  -o ../../exports/deck.pptx --selector .slide
```

### Fidelity

| Content type | Export result |
|---|---|
| Text | Real, selectable, editable text |
| Solid rectangles/ellipses, basic layout | Native PPTX shapes |
| CSS gradients, `filter: blur()`, some transforms | Rasterized to images (appearance preserved, not vector-editable) |
| Image fills | Embedded as pictures, crop/cover preserved |
| Non-16:9 slides | Letterboxed, never stretched or cropped |

### Troubleshooting

- **Headless browser fails to launch / falls back to Edge**: always use `scripts/export-pptx.mjs` (it works around the `dom-to-pptx@2.0.3` + `puppeteer@25` incompatibility); if it still fails, point to a browser with `--browser "C:/path/to/chrome.exe"`.
- **Images missing from the PPTX**: local images are inlined as base64 before rendering (to avoid `file://` canvas taint); if one is still missing, check that the image path resolves relative to the combined HTML.
- **Empty bars on a slide**: expected behavior for non-16:9 slides (contain-fit); re-author the slide to 16:9 in Pencil for a full-bleed page.
- **Text isn't editable in PowerPoint**: confirm you used `export-pptx.mjs` and that the source HTML contains real text nodes, not flattened images.

For more details, see [.claude/skills/pen2ppt/SKILL.md](.claude/skills/pen2ppt/SKILL.md).
