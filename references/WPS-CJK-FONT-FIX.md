# 修复:导出的 PPTX 在 WPS 中文字错乱 / 英文异常(字体未安装导致)

> 一句话:导出的 PPTX 里,文本运行的字体槽(`<a:latin>` / `<a:ea>` / `<a:cs>`)被写成了**只按名字引用的网页字体**(如 `Noto Sans SC` / `Noto Sans` / `Anton`),而这些字体**既没有嵌入文件、也没有装在目标机器上**。PowerPoint 回退较健壮尚能看;**WPS 回退很弱**,于是中文错乱(`<a:ea>` 槽)和英文异常(`<a:latin>` 槽,标题最明显)一起出现。修复:导出后把各槽位重定向到**目标机器必定存在、且设计规范自身注明的系统等价字体**(中文→微软雅黑,Noto Sans→Arial,Anton→Impact),并把含中文的运行标记为 `lang="zh-CN"`。

---

## 1. 问题现象

用本 skill(`pen2ppt`)导出的 `.pptx`,在 **Microsoft PowerPoint** 中大致正常,但在 **WPS 演示**中:

- **中文错乱**:字体被替换、文字重叠、异常换行、豆腐块(□);
- **英文很奇怪**:西文/数字被替换成意料之外的字体,标题尤其明显(如 `PART 01`、`CONTENTS`、目录序号 `01/02/03`、网址);
- 两种症状同根同源,都是**字体槽指向了未安装的网页字体**。

## 2. 复现环境

- 设计稿使用 Google Fonts(本例 `Noto Sans SC` / `Noto Sans` / `Anton`),仅在渲染时经 CDN 加载;
- 目标机器(Windows + WPS)**未安装**这些字体;
- 导出管线:Pencil `export_html` → `build-combined.mjs` → `export-pptx.mjs`(dom-to-pptx + PptxGenJS)。

最小复现:一页含中英文的 HTML(字体栈 `'Noto Sans', system-ui, sans-serif`)走一遍导出,解包 pptx 即可看到下述 XML。

## 3. 根因分析(已实证)

解包导出的 `.pptx`,一个中英混排文本运行(run)的字体声明如下:

```xml
<a:rPr lang="en-US" sz="3000" dirty="0">
  <a:latin typeface="Noto Sans" pitchFamily="34" charset="0"/>
  <a:ea    typeface="Noto Sans" pitchFamily="34" charset="-122"/>
  <a:cs    typeface="Noto Sans" pitchFamily="34" charset="-120"/>
</a:rPr>
<a:t>齿形误差 NotoSans 中文 ABC123</a:t>
```

同时压缩包内**没有任何 `ppt/fonts/*.fntdata` 字体文件**,`presentation.xml` 里**没有 `<p:embeddedFontLst>`** —— 字体**完全未嵌入**,仅以名字引用。

三个叠加的根因:

### 3.1 三个字体槽被灌进同一个网页字体 —— 主因

导出把 CSS 字体栈**只取第一个字体名**,再由 PptxGenJS 把这同一个字体写满 `a:latin` / `a:ea` / `a:cs` 三个槽:

- `dom-to-pptx` 取栈首字体(`dist/dom-to-pptx.mjs:2659`):
  ```js
  fontFace: style.fontFamily.split(',')[0].replace(/['"]/g, ''),
  ```
  对 `'Noto Sans', system-ui, sans-serif` 得到 `Noto Sans`;浏览器原本靠 `system-ui, sans-serif` 兜底,**这个兜底信息被丢弃**。
- `PptxGenJS` 写满三槽(`dist/pptxgen.cjs.js:5963`):
  ```js
  runProps += `<a:latin typeface="${opts.fontFace}" .../><a:ea typeface="${opts.fontFace}" .../><a:cs typeface="${opts.fontFace}" .../>`;
  ```

### 3.2 中文槽 `<a:ea>` 指向无 CJK 字形的字体 → 中文错乱

`Noto Sans` / `Anton` / `Geist` / `Inter` 这类字体**一个中文字形都没有**。中文的 `<a:ea>` 槽指向它们,缺字形。

### 3.3 拉丁槽 `<a:latin>` 指向未安装字体 → 英文异常

`Noto Sans` / `Anton` 没装在目标机器上,WPS 只能随机替换,标题(粗体/窄体如 Anton)替换后反差最大,于是"英文很奇怪"。

### 3.4 诱发因素:`lang="en-US"` + 字体未嵌入

PptxGenJS 默认 `lang="en-US"`,诱导 WPS 按西文规则处理中文;而自动嵌入逻辑因 Google Fonts 的 `<link>` 缺 `crossorigin="anonymous"` 读不到 `cssRules`(`dist/dom-to-pptx.mjs:3187`),一个字体都没嵌进去。

### 3.5 为什么 PowerPoint 正常、WPS 出问题

OOXML 规定同一运行内**按字符文种(script)分槽选字体**:拉丁字符用 `<a:latin>`,中日韩字符用 `<a:ea>`,复杂文种用 `<a:cs>`。当指定字体缺失/缺字形时,**PowerPoint** 的字体回退(尤其 CJK 回退)较健壮,宽度度量一致,版面大致正常;**WPS** 回退能力弱,替换字体与宽度度量不一致,于是重叠/错位/豆腐块/换字体。

### 3.6 补充实证:theme 引用槽与空 typeface(本仓库样例实测)

对本仓库自带的 `exports/Custom_ppt_template.pptx` 解包统计,除上述命名字体外还有两类文档最初未覆盖的槽位:

```
a:ea -> +mn-ea: 36     ← 引用 theme minorFont,而 theme 的 <a:ea typeface=""> 为空
a:ea -> (empty): 2     ← theme major/minorFont 的空东亚槽
a:ea -> Inter: 62  /  a:ea -> Noto Sans SC: 20   ← 3.1/3.2 的主因
```

`ppt/theme/theme1.xml` 的 majorFont/minorFont 中 `<a:ea typeface="">` 均为空,且 `ppt/presentation.xml` 的 `<p:defaultTextStyle>` 用 `+mn-lt`/`+mn-ea`/`+mn-cs` 引用 theme。只改命名字体槽不够——**必须把 theme XML 纳入重写范围**(并把 `+mn-ea`、空 typeface 一并处理),否则经 theme 解析的中文仍无确定字体。修复已覆盖(见 5.1)。

## 4. 技术原理(修复依据)

既然 OOXML **按文种分槽选字体**,正确的修法不是"嵌入字体",而是:

> **让每个槽位都指向目标机器必定存在、且能覆盖对应文种的系统字体。**

而设计规范(《钱江机器人模板设计规范》)早已注明这三款网页字体的**系统等价字体**:

| 用途 | 设计字体 | 规范注明的等价系统字体 |
|---|---|---|
| 中文标题 / 正文 | Noto Sans SC | **微软雅黑**(规范原文:"PPT 导出后回退系统黑体,版式不变") |
| 西文 / 网址 | Noto Sans | **Arial** |
| 目录序号数字 | Anton | **Impact**(粗窄体) |

微软雅黑、Arial、Impact 均随 Windows 预装、WPS 原生读取,**无需安装也无需嵌入**。于是:

- 中文 → `<a:ea>` 与中文为主的 `<a:latin>` → **微软雅黑**;
- 西文 → `<a:latin>` → **Arial**;目录序号 → **Impact**(保留粗窄体观感);
- 含中文的运行标记 `lang="zh-CN"`,让 WPS 用正确的中文换行规则。

## 5. 已实现的修复(改动内容)

在 skill 层做**导出后处理**(不改上游库、不改 `.pen`):

### 5.1 `scripts/fix-cjk-fonts.mjs`(可独立运行)

用 JSZip 打开 `.pptx`,对 `ppt/slides|notesSlides|slideLayouts|slideMasters|notesMasters`、`ppt/presentation.xml` 以及 **`ppt/theme/theme*.xml`** 下的 XML:

1. 把每个 `<a:ea typeface="...">` 重写为中文字体(默认 `Microsoft YaHei`)——**含 `+mn-ea`/`+mj-ea` 引用槽与空 `typeface=""`**;theme 的 major/minor 东亚槽一并填实,一处改、所有 `+mn-*` 引用与 `defaultTextStyle` 全部生效;
2. 把 `<a:latin>` / `<a:cs>` 按内置等价表重写为系统字体(默认 `Noto Sans SC→Microsoft YaHei`、`Noto Sans→Arial`、`Anton→Impact`、`Inter/Roboto/Geist→Arial`、`Geist Mono→Courier New`),**匹配大小写不敏感**(`noto sans` 也命中);`--map "From=To"` 可重复传入以扩展/覆盖、`--no-latin-map` 关闭;`Noto Sans SemiBold` 这类变体不命中,需 `--map` 补充;
3. 对实际含 CJK 字符的运行(`<a:r>` / `<a:fld>`)把 `lang` 改为 `zh-CN`;
4. 重新打包写回(`compression: DEFLATE`,无关 entry 如 `docProps/`、媒体文件原样保留;支持 `--dry` 预演、`--out` 另存)。

核心逻辑(节选):

```js
// 1. 所有东亚槽 -> 中文字体(含 +mn-ea、空 typeface、theme 槽)
xml = xml.replace(/(<a:ea\b[^>]*?\btypeface=")[^"]*(")/g, (m, pre, post) => `${pre}${eaFont}${post}`);
// 2. 拉丁/复杂文种槽 -> 系统等价字体(大小写不敏感)
for (const { re, to } of latinTable)
  xml = xml.replace(re, (m, pre, post) => `${pre}${to}${post}`);
// 3. 含 CJK 的运行 -> lang="zh-CN"
```

### 5.2 `export-pptx.mjs` 自动集成

导出写完文件后自动调用上述修复(`--map` 可重复传入):

```js
if (!has('--no-font-fix')) {
  const { fixCjkFontsFile, DEFAULT_EA_FONT } = await import('./fix-cjk-fonts.mjs');
  const maps = argv.filter((a, i) => argv[i - 1] === '--map');
  const stats = await fixCjkFontsFile(output, { eaFont: get('--ea-font', DEFAULT_EA_FONT), maps, noLatinMap: has('--no-latin-map') });
  // 日志:font fix: a:ea xN, a:latin/cs xM, lang=zh-CN xK
}
```

### 5.3 验证结果(本仓库样例 + 端到端实测)

**(a) 样例 deck(`exports/Custom_ppt_template.pptx` 副本)独立修复**——`node scripts/fix-cjk-fonts.mjs sample.pptx --dry` 输出:

```
XML parts changed: 14
rewrites: a:ea x129, a:latin/a:cs x164, lang=zh-CN x64
before:
  a:latin -> {"Calibri Light":1,"Calibri":1,"+mn-lt":36,"Inter":62,"Courier New":8,"Noto Sans SC":20,"+mj-lt":1}
  a:ea    -> {"(empty)":2,"+mn-ea":36,"Inter":62,"Courier New":8,"Noto Sans SC":20,"+mj-ea":1}
  a:cs    -> {"(empty)":2,"+mn-cs":36,"Inter":62,"Courier New":8,"Noto Sans SC":20,"+mj-cs":1}
after:
  a:latin -> {"Calibri Light":1,"Calibri":1,"+mn-lt":36,"Arial":62,"Courier New":8,"Microsoft YaHei":20,"+mj-lt":1}
  a:ea    -> {"Microsoft YaHei":129}
  a:cs    -> {"(empty)":2,"+mn-cs":36,"Arial":62,"Courier New":8,"Microsoft YaHei":20,"+mj-cs":1}
```

修复后校验:56 个 XML 部件全部良构;theme major/minor 的 `ea` 均为 `Microsoft YaHei`;`zh-CN` 运行 64 处;残留网页字体引用 0;24 个媒体文件原样未动。(`+mn-lt`/`+mn-cs` 保留是有意的:它们解析到 theme 的 Calibri/空槽,与 Office 默认主题行为一致;空的 theme `cs` 槽亦然——复杂文种槽对中英内容不参与渲染。)

**(b) 端到端导出**(一页含 `'Anton'` 标题 + `'Noto Sans', system-ui` 中文正文的 HTML):导出日志自动追加 `font fix: a:ea x41, a:latin/cs x4, lang=zh-CN x2`;`--no-font-fix` 时 `Anton`/`Noto Sans` 原样保留、无 `zh-CN`,确认开关生效。

**(c) 自行复核任何 deck** 的三槽分布,可用这段脚本(在 skill 目录下运行):

```js
// node tally-fonts.mjs deck.pptx —— 统计三槽 typeface 分布
const JSZip = require('jszip'), fs = require('fs');
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const tally = {};
  for (const f of Object.keys(zip.files).filter(n => /^ppt\/.*\.xml$/.test(n))) {
    const xml = await zip.files[f].async('string');
    for (const m of xml.matchAll(/<a:(latin|ea|cs)\b[^>]*typeface="([^"]*)"/g))
      tally[`a:${m[1]} -> ${m[2] || '(empty)'}`] = (tally[`a:${m[1]} -> ${m[2] || '(empty)'}`] || 0) + 1;
  }
  console.log(tally);
})();
```

## 6. 使用方法

```bash
# 常规导出(自动带字体修复:中文->雅黑,拉丁->系统等价)
node scripts/export-pptx.mjs combined.html -o out.pptx --selector .slide

# 关闭整个字体修复
node scripts/export-pptx.mjs combined.html -o out.pptx --selector .slide --no-font-fix

# 只修中文槽,拉丁槽保留设计字体(若你打算把网页字体装到本机)
node scripts/export-pptx.mjs combined.html -o out.pptx --selector .slide --no-latin-map

# 自定义:换中文字体 / 追加或覆盖某个拉丁字体映射
node scripts/export-pptx.mjs combined.html -o out.pptx --selector .slide \
     --ea-font "Noto Sans SC" --map "Anton=Arial Narrow"

# 修复一个已经导出的旧文件(就地覆盖;--dry 预演,--out 另存)
node scripts/fix-cjk-fonts.mjs old.pptx --dry
node scripts/fix-cjk-fonts.mjs old.pptx
node scripts/fix-cjk-fonts.mjs old.pptx --map "Some Font=Arial" --out fixed.pptx
```

## 7. 给上游(dom-to-pptx)的根治建议

skill 层后处理是稳妥兜底;更彻底的修复应在上游完成,供作者参考:

1. **按文种分别填槽**:不要取 `fontFamily.split(',')[0]` 灌满三槽。扫描完整字体栈,把第一个**含 CJK 字形**的字体写入 `<a:ea>`、栈首(拉丁)字体写入 `<a:latin>`;或暴露 `eaFont` / `latinFont` 选项。
2. **按文种标记 `lang`**:含 CJK 的运行写 `lang="zh-CN"`,而非一律 `en-US`。
3. **提供"系统等价回退"能力**:对未嵌入的网页字体,允许用户配置回退到的系统字体(如本修复的 `LATIN_EQUIVALENTS`),而不是依赖查看器随机替换。
4. **(可选)修复字体嵌入**:给 Google Fonts `<link>` 加 `crossorigin="anonymous"` 使 `cssRules` 可读;处理 woff2(可用旧 UA 索取 TTF)。但 CJK 字体体积巨大(Noto Sans SC 约 10MB+),且 WPS 对嵌入 EOT/子集字体兼容性不稳,**CJK 建议仍走系统字体**,至多嵌入拉丁字体。

## 8. 已知限制 / 后续

- **映射表覆盖的字体有限**:默认等价表只含常见网页字体(Noto 系列 / Anton / Inter / Roboto / Geist 系列)。设计稿若用其它网页字体,用 `--map "From=To"` 补充即可;拉丁槽未命中表中的字体仍会按名字保留,在未装该字体的机器上仍会被替换。
- **`charset` 属性保留不动**:原槽位上的 `charset="-122"`(即 GB2312 的有符号字节表示)在改成微软雅黑后依然兼容(雅黑覆盖 GB 字符集),无需规范化。
- **`<a:sym>` 符号槽刻意不动**;`+mn-lt`/`+mn-cs` 与 theme 的空 `cs` 槽保留,与 Office 默认主题行为一致(见 5.3-a)。
- **与原生图片补丁正交**:字体修复是导出后的 zip 层后处理,`native-image-patch.mjs` 是渲染期的浏览器层补丁,两者作用域不同,可安全组合;`--no-font-fix` 与 `--no-native-images` 互不影响。
- **观感是"系统等价"而非"逐字一致"**:Arial 之于 Noto Sans、Impact 之于 Anton、雅黑之于 Noto Sans SC,都是规范认可的等价替换,版式不变、风格高度接近,但严格来说不是同一字体。若要逐字一致,把对应免费 Google 字体装到本机,并用 `--no-latin-map` 保留原字体名(中文仍走雅黑)。
- **默认中文字体面向 Windows**(`Microsoft YaHei`);macOS 的 WPS 可用 `--ea-font "PingFang SC"` 指定。

---

### 附:涉及的关键文件

| 文件 | 改动 |
| --- | --- |
| `scripts/fix-cjk-fonts.mjs` | 新增。导出后处理:`a:ea` 改中文字体(含 theme、`+mn-ea`、空槽)、`a:latin/a:cs` 按等价表改系统字体(大小写不敏感)、CJK 运行标 `zh-CN`;可独立修复旧文件(`--dry`/`--out`/`--map`/`--ea-font`/`--no-latin-map`) |
| `scripts/export-pptx.mjs` | 导出后自动调用上述修复;新增 `--ea-font`、`--map`(可重复)、`--no-latin-map`、`--no-font-fix` |
| `package.json` | 显式声明 `jszip` 依赖(`fix-cjk-fonts.mjs` 直接引用;此前仅作为传递依赖存在) |
| `SKILL.md` | 排错与 Files 章节补充说明 |

> 注:根因位于上游依赖 `dom-to-pptx@2.0.3`(`node_modules/dom-to-pptx/dist/dom-to-pptx.mjs:2659`、`3187`)与 `pptxgenjs`(`node_modules/pptxgenjs/dist/pptxgen.cjs.js:5963`);行号随版本漂移,引用时请核对当前安装版本。本修复在 skill 层以后处理方式规避,不侵入上游;上游若按第 7 节根治,本后处理可作为兼容兜底保留。
