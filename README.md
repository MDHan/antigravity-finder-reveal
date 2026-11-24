<div align="center">

<img src="assets/logo.svg" width="84" height="84" alt="Antigravity Finder Reveal Logo" />

# Antigravity Finder Reveal

**为 Google Antigravity 2.0 打造的「访达快捷打开」侧边栏插件 · 零依赖 · 零 Token 消耗**

*A lightweight Google Antigravity 2.0 sidebar plugin that tracks modified files, groups them by category with color-coded icons, folds process/auxiliary files, and lets you reveal in Finder or open with any local macOS app in one click.*

[![Antigravity 2.0](https://img.shields.io/badge/Antigravity-2.0_Plugin-2563eb?style=flat-square&logo=google&logoColor=white)](https://github.com/MDHan/antigravity-finder-reveal)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-059669?style=flat-square)](https://github.com/MDHan/antigravity-finder-reveal)
[![Zero Token Cost](https://img.shields.io/badge/Token_Cost-Zero-16a34a?style=flat-square)](https://github.com/MDHan/antigravity-finder-reveal)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](LICENSE)

[核心特性](#features) · [快速安装](#install) · [使用说明](#usage) · [目录结构](#structure) · [English Guide](#english-guide)

</div>

---

<a id="features"></a>
## ✨ 核心特性（Features）

- **实时追踪文件变更（双源合并）**：通过 `PostToolUse` Hook 实时捕获每次 `write_file` / `edit_file` 修改，同时自动解析当前对话的 `transcript.jsonl`，安装前已修改的文件也能直接显示。
- **主次分层，突出重点**：
  - **主要文件**常驻展开在顶部，按细分类别自动归类并配以专属颜色与角标（空分组自动隐藏）：
    - 🟧 **演示文稿**（`PPT`：`.pptx`、`.ppt`、`.key`）
    - 🟥 **PDF 文档**（`PDF`：`.pdf`）
    - 🟦 **Word / 论文稿**（`DOC`：`.docx`、`.doc`、`.pages`、`.tex`、`.rtf`）
    - 🟩 **表格与数据**（`TBL`：`.xlsx`、`.csv`、`.tsv`、`.parquet`、`.jsonl` 等）
    - 🔷 **Markdown / 文档**（`.md`、`.mdx`、`.txt`、`.org` 等，所有 Markdown 文档独立归类）
    - 🌐 **网页文件**（`.html`、`.htm`、`.xhtml`、`.mhtml`）
    - 🟪 **代码与脚本**（`.py`、`.ipynb`、`.ts`、`.js`、`.sh`、`.go`、`.cpp` 等）
    - 🟨 **配置文件**（`.json`、`.yaml`、`.toml`、`.env`、`.ini` 等）
    - 🟢 **图片与图表**（`IMG`：`.png`、`.jpg`、`.svg`、`.webp` 等）
    - 🩷 **音频文件**（`AUD`：`.wav`、`.mp3`、`.flac`、`.m4a` 等）
    - 🟣 **视频文件**（`VID`：`.mp4`、`.mov`、`.mkv`、`.webm` 等）
    - ⚪ **其他文件**（`FILE`）
  - **过程与辅助文件**（如对话过程文档 `learning_proposal.md`、`task.md`、日志/锁文件、插件内部文件、已移除文件）默认折叠在底部，按需一键展开。
- **一键定位访达 & 选择任意本机 App 打开**：
  - 点击 **`打开`**：用系统默认应用直接打开文件。
  - 点击 **`▾`**（或右键 → **选择应用打开…**）：弹出带搜索框的应用列表，自动扫描本机 `/Applications`、`/System/Applications`、`~/Applications`，按文件类型置顶推荐应用（如 Typora、VS Code、Cursor、Preview 等）。
  - 点击 **`访达`** 或卡片任意处：调用 `open -R` 在 macOS 访达（Finder）中直接高亮定位该文件。
  - **右键菜单**：支持「用默认应用打开」「选择应用打开…」「在访达中显示」「打开所在文件夹」「复制完整路径」。
- **零依赖 & 零额外 Token 消耗**：纯 Node.js 标准库 + Antigravity 内置 `sidecar_sdk`，无需 `npm install`，自动跟随浅色 / 深色主题。

---

<a id="install"></a>
## 🚀 快速安装（Installation）

### 方式一：使用 `agy` CLI 一键安装（推荐）

```bash
agy plugin install https://github.com/MDHan/antigravity-finder-reveal
```

### 方式二：使用 `git clone` 克隆到插件目录

```bash
git clone https://github.com/MDHan/antigravity-finder-reveal.git ~/.gemini/config/plugins/finder-reveal
```

### 方式三：手动下载 ZIP

1. 点击本仓库 **Code → Download ZIP** 并解压。
2. 将目录重命名为 `finder-reveal`，放入 `~/.gemini/config/plugins/finder-reveal/`（确保 `plugin.json` 直接位于该目录下）。

> 安装完成后，Antigravity 会自动发现并加载插件（也可在左侧 **个性化定制 / Customizations** 中确认已启用）。

---

<a id="usage"></a>
## 🧭 使用说明（Usage）

1. 在任意对话右上角的 **`+`** 菜单中选择 **`访达快捷打开`**，即可在右侧辅助边栏打开面板。
2. 顶部可切换 **`当前对话`** 与 **`全部最近`** 视图。
3. 对列表中的任意文件：
   - **点 `打开`**：系统默认应用打开。
   - **点 `▾`**：搜索并选择任意已安装的 macOS 应用打开。
   - **点 `访达` / 左键卡片**：在访达中定位并高亮该文件。
   - **右键卡片**：打开完整快捷菜单（含打开所在目录与复制完整路径）。

---

<a id="structure"></a>
## 📁 目录结构（Project Structure）

```text
antigravity-finder-reveal/
├── plugin.json                        # Antigravity 插件清单
├── hooks.json                         # PostToolUse 文件变更监听配置
├── LICENSE                            # MIT License
├── README.md                          # 说明文档
├── assets/
│   └── logo.svg                       # 插件图标
├── scripts/
│   └── record_file.mjs                # Hook 脚本：记录修改文件路径到 plugin_data
└── sidecars/
    └── finder_panel/                  # 右侧辅助边栏 Sidecar 后端与前端 UI
        ├── sidecar.json
        ├── package.json
        ├── main.mjs                   # 文件分类、本机 App 扫描与 open/-R/-a 接口
        ├── index.html
        ├── styles.css
        └── app.js
```

---

<a id="english-guide"></a>
## 🌍 English Guide

### Overview

**Antigravity Finder Reveal** is a zero-dependency, zero-token-cost sidebar plugin for **Google Antigravity 2.0**. It tracks files created or edited by the agent, groups primary files by document category with color-coded icons, folds process/auxiliary files neatly at the bottom, and lets you **Reveal in Finder** (`open -R`) or **Open With** any installed macOS application in one click.

### Quick Install

```bash
# Option 1: Antigravity CLI
agy plugin install https://github.com/MDHan/antigravity-finder-reveal

# Option 2: Git Clone
git clone https://github.com/MDHan/antigravity-finder-reveal.git ~/.gemini/config/plugins/finder-reveal
```

Open it from the conversation top-right **`+`** menu → **`访达快捷打开`**.

### License

Released under the [MIT License](LICENSE).
