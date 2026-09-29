# Pen2ppt

将 Pencil (`.pen`) 设计稿转换为**可编辑的 PowerPoint (`.pptx`)** 演示文稿。
Convert Pencil (`.pen`) designs into **editable PowerPoint (`.pptx`)** decks.

本仓库本身就是一个 **Agent Skill**（仓库根目录即 Skill 目录），可安装到任何支持 SKILL.md 规范的 Agent（ZCode、Claude Code 等）中使用。
This repository **is** an Agent Skill — the repo root is the skill directory. Install it into any agent that understands the SKILL.md convention (ZCode, Claude Code, …).

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
- ✅ **图片填充保留**：图片填充以原始字节嵌入（PowerPoint 原生裁剪），不压缩不重编码
- ✅ **WPS 中文兼容**：导出后自动修复 WPS 下的中文字体乱码 / 西文字体替换问题
- ✅ **统一导出目录**：首次使用会引导设置一个导出路径（`PEN2PPT_WORKSPACE` 环境变量），之后所有导出按 `<工作区>/<名称>/` 归档，不再散落在各个项目里
- ✅ **模板库**：内置通用模板（极简商务 / 深色科技等），新建 PPT 时会询问选用哪个模板，scaffold 到工作区后在 Pencil 里按模板页型创作；也可导入自己的私有模板（存工作区 `_templates/`，不进仓库）
- ✅ **不改动原始 `.pen`**：所有尺寸转换都发生在 HTML→PPTX 阶段，源文件只读

### 仓库结构

仓库根目录就是 Skill 目录（目录名须为 `pen2ppt`）：

```
pen2ppt/
├── SKILL.md                        # Skill 说明与完整使用流程（Agent 读取）
├── package.json                    # 依赖：dom-to-pptx（自带 puppeteer + Chromium）、jszip
├── scripts/
│   ├── build-combined.mjs          # 拼接多个单页 HTML → combined.html
│   ├── export-pptx.mjs             # 无头 Chromium + dom-to-pptx → .pptx
│   ├── native-image-patch.mjs      # dom-to-pptx 内存补丁：图片原始字节嵌入 + 原生裁剪
│   ├── fix-cjk-fonts.mjs           # 导出后修复 WPS 中文字体乱码
│   ├── workspace.mjs               # 统一导出工作区（PEN2PPT_WORKSPACE）：get / set / dir
│   └── templates.mjs               # 模板库：list / new / add
├── templates/                      # 内置模板库（编排规范见 templates/README.md）
│   ├── minimal-business/           # 暖米杂志风（衬线标题 + 砖红点缀，同内容清单）
│   ├── dark-tech/                  # 深空科技风（Linear 风深色，同内容清单）
│   ├── teal-editorial/             # 青绿编辑风（10 种页型，含 preview.pptx）
│   └── blue-editorial/             # 企业蓝 · 极简编辑风（teal 内容的高级视觉重制）
├── references/
│   └── WPS-CJK-FONT-FIX.md         # 字体修复原理与参数说明
└── examples/
    └── Custom_ppt_template.pptx    # 青绿编辑风的导出成品示例
```

### 安装

把本仓库 clone 到 Agent 的 skills 目录，**目标目录名必须是 `pen2ppt`**（与 SKILL.md 中的 `name` 一致）：

```bash
# —— ZCode（推荐 .agents/skills，跨工具通用）——
# 用户级：所有项目可用
git clone git@github.com:FE-Berserker/Pen2ppt.git ~/.agents/skills/pen2ppt
# 或项目级：仅当前项目可用（在目标项目根目录执行）
git clone git@github.com:FE-Berserker/Pen2ppt.git .agents/skills/pen2ppt

# —— Claude Code ——
git clone git@github.com:FE-Berserker/Pen2ppt.git ~/.claude/skills/pen2ppt
# 或项目级
git clone git@github.com:FE-Berserker/Pen2ppt.git .claude/skills/pen2ppt

# 安装依赖（自带 Chromium，用于无头渲染）
cd <skills目录>/pen2ppt && npm install
```

Windows PowerShell 示例（ZCode 用户级）：

```powershell
git clone git@github.com:FE-Berserker/Pen2ppt.git "$HOME\.agents\skills\pen2ppt"
cd "$HOME\.agents\skills\pen2ppt"
npm install
```

> 更新：进入已安装的 `pen2ppt` 目录执行 `git pull && npm install` 即可。

### 前置条件

- Node.js
- 待转换的 `.pen` 文件，且已配置 Pencil MCP（提供 `export_html` 工具）
- 转换时需要联网（Tailwind 与字体在渲染时从 CDN 加载；离线时字体回退到系统字体，布局不受影响）

### 使用方式

安装后直接对 Agent 提出需求即可，例如：

> "把这个 .pen 文件导出成 PPT"
> "只要封面和目录两页，输出为 intro.pptx"
> "用 1920×1080 的尺寸导出"
> "帮我做一套三季度工作汇报"（新建场景）

**已有 .pen**：直接转换，不问模板。**新建 PPT**（手里没有 .pen）：会列出内置模板和你的私有模板（`<工作区>/_templates/`）让你选，选好后在工作区 scaffold 出 `<工作区>/<名称>/<名称>.pen`，在 Pencil 里复制模板页型做新页，然后走正常导出。想导入自己的模板："把我的模板加进去"，或直接运行 `node <skills目录>/pen2ppt/scripts/templates.mjs add <模板文件夹>`。

流水线会自动完成：读取顶层 Frame → 逐页 `export_html` → 拼接 → 渲染 PPTX → 报告输出路径、页数及非 16:9 页面的适配提示。所有产物都落在统一的导出工作区下（首次使用会引导你设置路径，也可用 `PEN2PPT_WORKSPACE` 环境变量指定），按 `<工作区>/<名称>/` 分子目录归档。

也可以手动运行脚本（脚本用绝对路径调用，与工作目录无关）：

```bash
# 0. 解析/创建本次导出的子目录（首次使用需先 set 一个统一路径）
W=$(node <skills目录>/pen2ppt/scripts/workspace.mjs dir my-deck)

# 1. 拼接（按幻灯片顺序传入各页 HTML）
node <skills目录>/pen2ppt/scripts/build-combined.mjs --out "$W/combined.html" \
  "$W"/slide-01.html "$W"/slide-02.html

# 2. 渲染为 PPTX（固定 16:9；可用 --width/--height 指定其他 16:9 尺寸）
node <skills目录>/pen2ppt/scripts/export-pptx.mjs "$W/combined.html" \
  -o "$W/deck.pptx" --selector .slide
```

想先试试效果？`templates/` 下有四套内置模板可直接新建；`examples/` 里留有导出的成品 PPTX 样例。

### 还原度说明

| 内容类型 | 导出效果 |
|---|---|
| 文本 | 真实可选中编辑的文字 |
| 纯色矩形/椭圆、基础布局 | PPTX 原生形状 |
| CSS 渐变、`filter: blur()`、部分变换 | 栅格化为图片（外观一致，不可矢量编辑） |
| 图片填充 | 原始字节嵌入，crop/cover 保留 |
| 非 16:9 页面 | letterbox 留边，绝不拉伸或裁剪 |

### 常见问题

- **无头浏览器启动失败 / 错误地使用了 Edge**：务必使用 `scripts/export-pptx.mjs`（已处理 `dom-to-pptx@2.0.3` 与 `puppeteer@25` 的兼容问题）；仍失败可用 `--browser "C:/path/to/chrome.exe"` 指定浏览器。
- **WPS 中文字体乱码**：`export-pptx.mjs` 导出后已自动修复；旧文件可单独运行 `node scripts/fix-cjk-fonts.mjs old.pptx` 修复，原理见 [references/WPS-CJK-FONT-FIX.md](references/WPS-CJK-FONT-FIX.md)。
- **PPTX 中图片丢失**：本地图片会在渲染前内联为 base64（避免 `file://` 污染 canvas）；若仍缺失，检查图片路径是否相对于 combined HTML 可解析。
- **页面出现空白边**：这是非 16:9 页面 contain-fit 的预期行为；在 Pencil 中将该页改为 16:9 即可全幅铺满。
- **PowerPoint 中文字不可编辑**：确认使用的是 `export-pptx.mjs`，且源 HTML 中是真实文本节点而非被拍平的图片。

更多细节见 [SKILL.md](SKILL.md)。

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
- ✅ **Image fills at original fidelity**: images embed as original bytes with PowerPoint-native cropping — no downscaling, no re-encoding
- ✅ **WPS CJK compatibility**: an automatic post-export fix repairs garbled CJK / substituted Latin fonts in WPS
- ✅ **One shared export workspace**: the first run prompts for an output directory (the `PEN2PPT_WORKSPACE` env var); every export is then archived under `<workspace>/<name>/` instead of being scattered across projects
- ✅ **Template library**: built-in generic templates (minimal business, dark tech, …). Creating a NEW deck asks which template to use, scaffolds it into the workspace, and you author pages in Pencil from the template's page types. Personal templates live in the workspace `_templates/` — never in the repo
- ✅ **Original `.pen` untouched**: all size conversion happens in the HTML→PPTX step; the source file is read-only

### Repository Structure

The repo root **is** the skill directory (it must be named `pen2ppt`):

```
pen2ppt/
├── SKILL.md                        # Skill docs and full workflow (read by the agent)
├── package.json                    # Dependencies: dom-to-pptx (bundles puppeteer + Chromium), jszip
├── scripts/
│   ├── build-combined.mjs          # Stitch per-frame HTML files → combined.html
│   ├── export-pptx.mjs             # Headless Chromium + dom-to-pptx → .pptx
│   ├── native-image-patch.mjs      # In-memory dom-to-pptx patch: original-byte image embedding + native crop
│   ├── fix-cjk-fonts.mjs           # Post-export fix for garbled CJK fonts in WPS
│   ├── workspace.mjs               # Shared export workspace (PEN2PPT_WORKSPACE): get / set / dir
│   └── templates.mjs               # Template library: list / new / add
├── templates/                      # Built-in templates (conventions: templates/README.md)
│   ├── minimal-business/           # Warm mocha editorial (serif display + brick accents)
│   ├── dark-tech/                  # Deep-space Linear-style dark theme
│   ├── teal-editorial/             # Teal editorial, 10 page types (with preview.pptx)
│   └── blue-editorial/             # Enterprise blue premium restyle of teal-editorial's content
├── references/
│   └── WPS-CJK-FONT-FIX.md         # How the font fix works and its options
└── examples/
    └── Custom_ppt_template.pptx    # Sample PPTX exported from the teal-editorial theme
```

### Installation

Clone this repo into your agent's skills directory — **the target directory must be named `pen2ppt`** (matching `name` in SKILL.md):

```bash
# —— ZCode (.agents/skills recommended, works across agent tools) ——
# User-level: available in every project
git clone git@github.com:FE-Berserker/Pen2ppt.git ~/.agents/skills/pen2ppt
# Or project-level: this project only (run from the project root)
git clone git@github.com:FE-Berserker/Pen2ppt.git .agents/skills/pen2ppt

# —— Claude Code ——
git clone git@github.com:FE-Berserker/Pen2ppt.git ~/.claude/skills/pen2ppt
# Or project-level
git clone git@github.com:FE-Berserker/Pen2ppt.git .claude/skills/pen2ppt

# Install dependencies (bundles Chromium for headless rendering)
cd <skills-dir>/pen2ppt && npm install
```

Windows PowerShell (ZCode, user-level):

```powershell
git clone git@github.com:FE-Berserker/Pen2ppt.git "$HOME\.agents\skills\pen2ppt"
cd "$HOME\.agents\skills\pen2ppt"
npm install
```

> To update: `git pull && npm install` inside the installed `pen2ppt` directory.

### Prerequisites

- Node.js
- A `.pen` file to convert, with Pencil MCP configured (provides the `export_html` tool)
- Internet access during conversion (Tailwind and fonts load from CDN at render time; offline, fonts fall back to system fonts but layout survives)

### Usage

Once installed, just ask your agent, e.g.:

> "Export this .pen file to PowerPoint"
> "Only the cover and agenda slides, output as intro.pptx"
> "Export at 1920×1080"
> "Make me a Q3 work report deck" (new-deck scenario)

**With an existing .pen**: straight conversion, no template question. **New deck** (no .pen in hand): you'll be asked to pick from built-in templates and your personal ones (`<workspace>/_templates/`); the choice is scaffolded to `<workspace>/<name>/<name>.pen`, you author pages in Pencil by duplicating the template's page-type frames, then the normal export runs. To import your own template: "add my template folder", or run `node <skills-dir>/pen2ppt/scripts/templates.mjs add <folder>`.

The pipeline automatically: reads top-level frames → `export_html` per frame → stitches → renders PPTX → reports the output path, slide count, and any non-16:9 fitting warnings. Everything lands in one shared export workspace (the first run walks you through setting it; you can also set the `PEN2PPT_WORKSPACE` env var), archived per deck under `<workspace>/<name>/`.

You can also run the scripts manually (invoke them by absolute path — cwd doesn't matter):

```bash
# 0. Resolve/create this export's subdirectory (first run requires `set` once)
W=$(node <skills-dir>/pen2ppt/scripts/workspace.mjs dir my-deck)

# 1. Stitch (pass per-frame HTML files in slide order)
node <skills-dir>/pen2ppt/scripts/build-combined.mjs --out "$W/combined.html" \
  "$W"/slide-01.html "$W"/slide-02.html

# 2. Render to PPTX (fixed 16:9; use --width/--height for other 16:9 sizes)
node <skills-dir>/pen2ppt/scripts/export-pptx.mjs "$W/combined.html" \
  -o "$W/deck.pptx" --selector .slide
```

Want a quick try? `templates/` ships four built-in themes ready to scaffold; `examples/` keeps a sample exported PPTX.

### Fidelity

| Content type | Export result |
|---|---|
| Text | Real, selectable, editable text |
| Solid rectangles/ellipses, basic layout | Native PPTX shapes |
| CSS gradients, `filter: blur()`, some transforms | Rasterized to images (appearance preserved, not vector-editable) |
| Image fills | Original bytes embedded, crop/cover preserved |
| Non-16:9 slides | Letterboxed, never stretched or cropped |

### Troubleshooting

- **Headless browser fails to launch / falls back to Edge**: always use `scripts/export-pptx.mjs` (it works around the `dom-to-pptx@2.0.3` + `puppeteer@25` incompatibility); if it still fails, point to a browser with `--browser "C:/path/to/chrome.exe"`.
- **Garbled CJK fonts in WPS**: `export-pptx.mjs` auto-fixes decks after export; for older decks run `node scripts/fix-cjk-fonts.mjs old.pptx`. Background: [references/WPS-CJK-FONT-FIX.md](references/WPS-CJK-FONT-FIX.md).
- **Images missing from the PPTX**: local images are inlined as base64 before rendering (to avoid `file://` canvas taint); if one is still missing, check that the image path resolves relative to the combined HTML.
- **Empty bars on a slide**: expected behavior for non-16:9 slides (contain-fit); re-author the slide to 16:9 in Pencil for a full-bleed page.
- **Text isn't editable in PowerPoint**: confirm you used `export-pptx.mjs` and that the source HTML contains real text nodes, not flattened images.

For more details, see [SKILL.md](SKILL.md).
