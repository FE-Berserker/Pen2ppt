# pen2ppt 模板库

本目录是 pen2ppt 的**内置模板库**。模板是"一套 PPT 的设计起点"：新建演示文稿时，agent 会列出模板供用户选择，把选中的模板复制到工作区并改名为新文稿的名字。

## 两层模板来源

| 层 | 位置 | 说明 |
|---|---|---|
| 内置层 | 本仓库 `templates/<id>/` | 随 skill 分发，只放**通用、无品牌、无版权素材**的模板 |
| 用户层 | `<工作区>/_templates/<id>/` | 用户私有模板（如企业品牌模板），在本地工作区，**不进 git、不同步远程** |

`templates.mjs list` 合并展示两层，同名 id 时**用户层覆盖内置层**（用户可以魔改内置模板而不动仓库）。

## 目录编排规范

一个模板一个目录，目录名即模板 id（kebab-case）：

```
templates/
├── minimal-business/             # 暖米杂志风（衬线标题 + 砖红点缀）
│   ├── template.json             # 元数据（可选但建议）
│   ├── template.pen              # 模板源文件（必需）
│   └── SPEC.md                   # 设计规范，agent 创作新页前阅读（可选但建议）
├── dark-tech/                    # 深空科技风（Linear 风深色）
│   ├── template.json
│   ├── template.pen
│   └── SPEC.md
├── teal-editorial/               # 青绿编辑风（含预览）
│   ├── template.json
│   ├── template.pen
│   ├── SPEC.md
│   └── preview.pptx
└── blue-editorial/               # 企业蓝 · 极简编辑风（teal 内容的高级视觉重制）
    ├── template.json
    ├── template.pen
    └── SPEC.md
```

### 文件规则

| 文件 | 必需性 | 说明 |
|---|---|---|
| `template.pen` | **必需** | 统一用此名；scaffold 时只有它会被改名（→ `<演示名>.pen`） |
| `images/` 等素材目录 | 条件必需 | `.pen` 引用了本地素材就必须带，且保持被引用的相对路径结构（如 `images/xxx.png`） |
| `template.json` | 可选 | `{"name": "显示名", "description": "一句话描述", "tags": [...]}`，缺省时回退用目录名 |
| `SPEC.md` | 可选但建议 | 设计规范。模板一半的价值在"怎么用"，参考现有两个模板的写法（设计令牌 → 页面类型 → 文案语言 → Do/Don't） |
| `preview.pptx` | 可选 | 人类预览用，agent 流程不读，也不拷入工作区 |

### scaffold 拷贝规则（`templates.mjs new`）

- 拷贝：模板目录内**除 `template.json` 与 `preview.*` 外的一切**（含任意素材子目录、SPEC.md）
- 改名：`template.pen` → `<演示名>.pen`
- 目标目录已存在且非空时拒绝覆盖（`--force` 除外）

## 如何添加模板

**个人模板**（不进仓库）：`node scripts/templates.mjs add <源文件夹> [id]` —— 拷贝到 `<工作区>/_templates/<id>/`，自动识别 .pen / 规范 md / 成品 pptx 并归位命名。

**内置模板**（提交到仓库）：
1. 按上面的目录结构放入 `templates/<id>/`
2. `.pen` 画幅统一 1280×720（16:9），顶层 frame = 页型，命名格式 `0X 名称 Name`
3. 设计令牌存为 `.pen` 变量（`$accent` 等），SPEC.md 里列清楚
4. 只用流水线已加载且 `fix-cjk-fonts` 已有映射的字体（Noto Sans SC / Noto Sans / Anton / Geist Mono）
5. 不得包含品牌 logo、版权图库素材；视觉以形状/纯色/渐变完成
6. 提交前用 pen2ppt 流水线实际导出一遍验证（可同时产出 `preview.pptx`）

## 候选模板（尚未制作，欢迎补充）

- `academic-defense` — 学术答辩（页眉章节 + 页码、参考文献页型）
- `product-launch` — 产品发布（大图位用渐变占位块，SPEC 说明替换方法）
- `training-course` — 培训课件（知识点页、练习题页型）
- `retro` — 项目复盘（时间线、数据对比页型）
