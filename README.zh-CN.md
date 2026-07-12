[English](README.md) | [简体中文](README.zh-CN.md)

# Gmail 自动清理 + 每日摘要仪表盘

**对应的 Google Apps Script 项目：**`GmailAutoCleanV6`。本仓库是这个 Apps Script 项目代码的 git 镜像——Apps Script 本身没有原生的 git 集成，两边需要手动保持同步（从 Apps Script 里复制代码 → 比对 → 推送到 GitHub，跟 `Twilio-V2` 仓库用的是同一套流程）。

基于 Google Apps Script 和 Gemini AI 的自动化 Gmail 管理工具，配合 Cloudflare 托管的网页仪表盘，可随时浏览每日摘要。

## 功能介绍

三个触发器函数分别负责不同的处理流程：

**`gmailPinOnly`** — 每 5〜10 分钟运行一次：
- 将重要邮件（银行、学校、政府）置顶回收件箱

**`gmailAutoCleanLight`** — 每天一次（建议早上 6 点）：
- 清理分类邮件 — 将"更新"/"论坛"/"社交"标记为已读，将"推广"归档
- 自动打标签 — `! AUTO/Finance`、`! AUTO/School`、`! AUTO/Work`

**`gmailAutoCleanAI`** — 每天一次（建议早上 7 点）：
- AI 分析（Gemini）— 将收件箱未读邮件分类为：
  - `must_do` — 加星标，有截止日期时写入 Google 日历
  - `schedule_later` — 仅记录
  - `info_only` — 不做操作
- AI 结果后处理：
  - **黑名单发件人**（`aiActionBlocklistSenders`）— 将 `must_do` 降级为 `schedule_later`
  - **升级发件人**（`aiActionScheduleLaterSenders`）— 将 `info_only` 升级为 `schedule_later`
- 发送摘要邮件，附带网页仪表盘链接
- 将摘要保存到 Cloudflare KV，每天的结果永久可访问

**来电提醒**（`CallReminder.gs`）每分钟运行一次：

- 监视带有 `! Call` 标签的邮件
- 在"Call"日历中创建 1 小时的事件，时间定在当天 7pm（已过 7pm 则安排次日）
- 使用 Gemini 在事件描述中生成 2–3 句摘要
- 移除 `! Call` 标签，添加 `! Call - Done`，并将邮件标记为已读
- 夜间节流（11pm – 7am）：最多每小时执行一次

**Telegram 机器人**（`TelegramBot.gs`）每分钟运行一次（轮询模式）：

- 接收来自你私人 Telegram 聊天的指令
- `/run` — 立即触发 Gmail 自动清理
- `/call` — 立即触发来电提醒检查
- `/donetasks` — 将所有 `! AUTO` Google Tasks 标记为已完成
- `/help` — 列出所有指令

---

## 网页仪表盘

**网址：** `https://dash-gmail.1000600.xyz`

- 通过 `https://dash-gmail.1000600.xyz/YYYY-MM-DD` 浏览任意日期
- 用 ← 上一天 / 下一天 → 按钮在日期间切换
- 显示"必须处理 / 稍后安排 / 仅供参考"三个区块，含 AI 截止日期标签
- 鼠标悬停任意条目可查看邮件预览弹窗，显示收件时间、发件人、主题、正文摘要及 AI 分类原因
- 悬停时页面其余部分自动变暗，弹窗更加突出清晰
- 点击 **Open →** 直接跳转到 Gmail 对应邮件串

---

## 仓库结构

```
code.gs                      # 主 Apps Script — 每日清理、AI 分析、摘要
CallReminder.gs              # 来电提醒 — 监视 ! Call 标签，创建日历事件
TelegramBot.gs               # Telegram 机器人 — 轮询模式，远程触发指令
index.html                   # Cloudflare Pages 仪表盘 UI
functions/
  api/
    latest-run.js            # GET  — 读取最新摘要（KV → Apps Script 兜底）
    write-run.js             # POST — 由 Apps Script 调用，保存每日摘要
    run/[date].js            # GET  — 从 KV 读取指定日期的摘要
_redirects                   # SPA 路由日期 URL + 已删除页面的 301 重定向
```

---

## 部署说明

### 第一步 — Google Apps Script

1. 打开 [script.google.com](https://script.google.com)，创建新项目
2. 将 `code.gs` 的内容粘贴到默认文件中
3. 创建额外的脚本文件，分别粘贴 `CallReminder.gs` 和 `TelegramBot.gs`
4. 在"服务"中启用 **Tasks API** 和 **Calendar API**
5. 在"项目设置 → 脚本属性"中添加以下属性：

| 属性 | 值 |
|---|---|
| `GEMINI_API_KEY` | 你的 Gemini API 密钥 |
| `DASHBOARD_TOKEN` | 任意长随机字符串（共享密钥） |
| `TELEGRAM_BOT_TOKEN` | 你的 Telegram 机器人 Token（来自 @BotFather） |
| `TELEGRAM_CHAT_ID` | 你的 Telegram Chat ID |

6. 部署为 **Web App**：执行身份选"我"，访问权限选"任何人"
7. 复制 Web App URL

> **编辑本地文件或推送前，务必先执行 `git pull`**，尤其是在 GitHub 网页上直接修改过文件之后。否则本地版本可能会覆盖 GitHub 上的改动。
>
> **后续更新脚本：** 使用 **部署 → 管理部署 → 编辑（铅笔图标）→ 新版本 → 部署** 来保持同一 URL 不变。如果不小心创建了新部署（会生成新 URL），需在 Cloudflare 环境变量中更新 `APPS_SCRIPT_URL` 并重新部署 Pages：
> ```bash
> npx wrangler pages deploy . --project-name gmail-dashboard --branch main
> ```
> 如果仪表盘返回 `{"error":"Unknown action"}`，说明 Apps Script 部署的是旧代码 — 创建新部署并更新环境变量即可。

### 第二步 — Cloudflare Pages

```bash
npx wrangler pages project create gmail-dashboard --production-branch main
npx wrangler pages deploy .
```

在 Cloudflare 控制台 → Pages → `gmail-dashboard` → **设置** 中配置：

**环境变量**（生产环境）：

| 变量名 | 值 |
|---|---|
| `APPS_SCRIPT_URL` | 第一步中的 Web App URL |
| `DASHBOARD_TOKEN` | 与脚本属性中相同的 Token |

**Functions → KV 命名空间绑定**（生产环境）：

| 变量名 | 命名空间 |
|---|---|
| `GMAIL_DIGEST_KV` | `GMAIL_DIGEST` |

创建 KV 命名空间：
```bash
npx wrangler kv namespace create GMAIL_DIGEST
```

**自定义域名：** 在"自定义域"中添加 `dash-gmail.1000600.xyz`。

### 第三步 — 触发器

在 Apps Script 中设置触发器（触发器 → 添加触发器）：

| 函数 | 计划 | 说明 |
|---|---|---|
| `gmailPinOnly` | 基于时间 → 每 5〜10 分钟 | 仅将重要邮件置顶到收件箱 |
| `gmailAutoCleanLight` | 基于时间 → 天计时器（建议早上 6 点） | 分类清理 + 自动标签 |
| `gmailAutoCleanAI` | 基于时间 → 天计时器（建议早上 7 点） | AI 分析、执行动作、写入仪表盘、发摘要邮件 |
| `checkCallLabelAndCreateEvent` | 基于时间 → 每分钟 | 来电提醒 — 监视 `! Call` 标签 |
| `pollTelegramMessages` | 基于时间 → 每分钟 | Telegram 机器人 — 轮询新指令 |

手动运行一次 `setupCallReminderTrigger()` 和 `setupTelegramPollingTrigger()` 即可自动创建分钟级触发器。

### 第四步 — Telegram 机器人配置

1. 在 Telegram 中找 [@BotFather](https://t.me/BotFather) → `/newbot` → 复制 Token
2. 向你的新机器人发送任意消息，然后访问：
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   从响应中复制 `chat.id` 的值
3. 将两个值添加为脚本属性（`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`）
4. 手动运行一次 `setupTelegramPollingTrigger()` 以启动轮询

### 第五步 — 来电提醒标签配置

在 Gmail 中手动创建标签 `! Call`。`! Call - Done` 标签会在首次使用时自动创建。

---

## 配置说明

### code.gs — `CONFIG` 对象

| 配置项 | 说明 |
|---|---|
| `dryRun` | 设为 `true` 可模拟运行而不做任何实际修改 |
| `whitelistSenders` | 完全跳过清理和 AI 分析的发件人 |
| `aiActionBlocklistSenders` | 此类发件人的 `must_do` 项会被降级为 `schedule_later` |
| `aiActionScheduleLaterSenders` | 此类发件人的 `info_only` 项会被升级为 `schedule_later` |
| `categories` | 启用/禁用并配置各 Gmail 分类 |
| `labelRules` | 用于自动打标签的关键词和发件人 |
| `aiModel` | Gemini 模型（默认：`gemini-2.5-flash`） |
| `aiMaxThreads` | 每次运行发送给 AI 的最大邮件数（默认：20） |
| `pinCriteria` | 用于将邮件置顶到收件箱的 Gmail 搜索条件 |
| `dashboardSpreadsheetId` | 原始数据日志的 Google Sheets ID |

### CallReminder.gs — `CALL_REMINDER_CONFIG` 对象

| 配置项 | 说明 |
|---|---|
| `labelName` | 监视的 Gmail 标签（默认：`! Call`） |
| `labelDoneName` | 处理完成后添加的标签（默认：`! Call - Done`） |
| `calendarName` | 创建事件的 Google 日历（默认：`Call`） |
| `eventStartHour` | 日历事件时间，24 小时制（默认：`19` = 晚上 7 点） |
| `eventDurationHours` | 事件时长，单位小时（默认：`1`） |
| `titleMaxLength` | 从邮件主题截取的最大字符数作为事件标题（默认：`30`） |
| `nightStartHour` | 夜间节流开始时间，24 小时制（默认：`23` = 晚上 11 点） |
| `nightEndHour` | 夜间节流结束时间，24 小时制（默认：`7` = 早上 7 点） |
| `dryRun` | 设为 `true` 可模拟运行而不创建事件或修改标签 |
