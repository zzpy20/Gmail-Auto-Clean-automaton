/***********************
 * Gmail Auto Clean v6.2
 * 功能：
 * - 分类清理（Updates / Forums / Promotions / Social）
 * - 自动标签（! AUTO/Finance / School / Work）
 * - AI 提取待办（must_do / schedule_later / info_only）
 * - must_do 自动加星、写入 Google Tasks、写入 Google Calendar
 * - 写入 Google Sheets Dashboard
 * - 执行摘要邮件 + 错误通知
 * - dryRun 模式
 * - AI 结果去重
 * - Pin to Inbox：将符合条件的邮件移入收件箱并标记未读
 * last version before the web UI dashboard 
 ***********************/

const CONFIG = {
  // ===== 基本设置 =====
  dryRun: false,
  batchSize: 100,
  maxLoopsPerQuery: 50,

  // ===== 分类规则 =====
  categories: {
    purchases:  { enabled: false },
    updates:    { enabled: true, olderThanDays:14, action: "markRead" },
    forums:     { enabled: true, action: "markRead" },
    promotions: { enabled: true, action: "markReadAndArchive" },
    social:     { enabled: true, olderThanDays: 14, action: "markRead" }
  },

  // ===== 白名单发件人 =====
  whitelistSenders: [
    // 学校
    "school", "eq.edu.au",
    // 政府
    "mygov", "ato.gov.au", "servicesaustralia",
    // 银行
    "commbank", "anz", "nab", "westpac",
    // 核心账号
    // 核心账号
    "@accounts.google.com",   // Google 账号安全通知
    "@googlemail.com",        // Gmail 官方邮件
    "apple.com",
   
    // 医疗
    "@health.qld.gov.au", "hospital"

    
  ],

  // ===== 邮件通知 =====
  sendExecutionSummaryEmail: true,
  sendErrorEmail: true,

  // ===== AI =====
  // API key 存放在 Script Properties → GEMINI_API_KEY
  aiEnabled: true,
  aiRunInDryMode: true,
  aiModel: "gemini-2.5-flash",
  geminiApiKey: PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY"),
  // aiSearchQuery: 'in:inbox is:unread -is:starred newer_than:1d',
  aiSearchQuery: 'in:inbox is:unread -is:starred newer_than:1d -label:!-Call',
  aiMaxThreads: 20,
  aiMaxBodyCharsPerEmail: 1200,

  // ===== 自动标签 =====
  autoLabelsEnabled: true,
  autoLabelSearchQuery: 'in:inbox is:unread newer_than:14d',
  autoLabelMaxThreads: 100,
  autoLabelPriority: ["school", "finance", "work"],

  labelRules: {
    finance: {
      labelName: '! AUTO/Finance',
      keywords: ['invoice','receipt','payment','paid','due','overdue','statement','bill','tax','refund'],
      senderIncludes: ['paypal','stripe','bank','ato']
    },
    school: {
      labelName: '! AUTO/School',
      keywords: ['school','newsletter','class','classroom','teacher','excursion','homework','uniform','camp','parent'],
      senderIncludes: ['.school','eq.edu.au','education']
    },
    work: {
      labelName: '! AUTO/Work',
      keywords: ['quote','client','project','meeting','contract','site','scope','schedule'],
      senderIncludes: ['danlaid.com','danlaid.com.au','AccountRight@apps.myob.com']
    }
  },

  // ===== Google Tasks =====
  tasksEnabled: true,
  taskListName: "! AUTO Tasks",

  // ===== Google Calendar =====
  calendarEnabled: true,
  calendarName: "! AUTO Tasks",
  calendarCreateOnlyForMustDo: true,

  // ===== Dashboard Sheet =====
  dashboardEnabled: true,
  dashboardSpreadsheetId: "1GTJ27KuPDzPTSPnCaq8XHY4YWLk3KVjoZkuht-yHW4Y",
  dashboardSheetName: "Daily Actions",

  // ===== 去重保留天数 =====
  dedupeRetentionDays: 45,

  // ===== Pin to Inbox =====
  pinToInboxEnabled: true,
  pinCriteria: [
    "from:rochedalss@epublisher.net.au subject:Rochedale State School",   // 1. 备用
    "from:(@eq.edu.au OR @gov.au)",   // 2. 备用
    "from:(@commbank.com.au OR @cba.com.au OR @westpac.com.au OR @anz.com OR @nab.com.au OR @paypal.com OR @stripe.com OR @linkt.com.au)",   // 3. 备用
    "subject:(urgent OR invoice OR bill OR quote OR due OR overdue OR fine OR Reference OR infringement OR rego OR ATO OR myGov OR reminder OR 'action required' OR 'important notice')",   // 4. 备用
   
    "",   // 5. 备用
    "",   // 6. 备用
    "",   // 7. 备用
    "",   // 8. 备用
    "",   // 9. 备用
    "",   // 10. 备用
  ],
};


/* =========================
 * 主函数
 * ========================= */

function gmailAutoCleanV62() {
  const runStartedAt = new Date();
  const executionSummary = [];

  try {
    validateAutoLabelConfig();
    cleanupOldDedupeKeys();

    executionSummary.push(`Run time: ${runStartedAt}`);
    executionSummary.push(`Dry run: ${CONFIG.dryRun}`);
    executionSummary.push(`AI runs in dry mode: ${CONFIG.aiRunInDryMode}`);

    // 0) Pin 置顶 — 最先运行，避免被后续模块标记已读
    const pinResults = pinImportantEmailsToInbox();
    executionSummary.push("=== Pin to Inbox ===");
    pinResults.forEach(line => executionSummary.push(line));

    // 1) 分类清理
    const categoryResults = processConfiguredCategories();
    executionSummary.push("=== Category Processing ===");
    categoryResults.forEach(line => executionSummary.push(line));

    // 2) 自动标签
    if (CONFIG.autoLabelsEnabled) {
      const labelResults = applyAutoLabels();
      executionSummary.push("=== Auto Labels ===");
      labelResults.forEach(line => executionSummary.push(line));
    }

    // 3) AI 提取动作
    let aiResult = null;
    if (CONFIG.aiEnabled) {
      aiResult = buildDailyActionsWithAI();
      executionSummary.push("=== AI Actions ===");
      executionSummary.push(`Must do: ${aiResult.must_do.length}`);
      executionSummary.push(`Schedule later: ${aiResult.schedule_later.length}`);
      executionSummary.push(`Info only: ${aiResult.info_only.length}`);
    }

    // 4) 执行动作：加星 / Tasks / Calendar
    if (aiResult) {
      const actionResults = processAIActionResults(aiResult);
      executionSummary.push("=== AI Action Execution ===");
      actionResults.forEach(line => executionSummary.push(line));

      // 5) 写 Dashboard
      if (CONFIG.dashboardEnabled) {
        appendActionsToDashboard(aiResult, runStartedAt);
        executionSummary.push("Dashboard updated.");
      }
    }

    // 6) 发汇总邮件
    if (CONFIG.sendExecutionSummaryEmail) {
      let body = executionSummary.join("\n");
      if (aiResult) {
        body += "\n\n=== 今日待办（来自邮件）===\n\n";
        body += formatActionDigest(aiResult);
      }
      sendExecutionSummaryEmail(body, "Gmail Auto Clean v6.2 Summary");
    }

    Logger.log(executionSummary.join("\n"));

  } catch (error) {
    Logger.log(`ERROR: ${error.stack || error}`);
    if (CONFIG.sendErrorEmail) sendErrorAlert(error);
    throw error;
  }
}


/* =========================
 * 0) Pin to Inbox
 * 将符合 CONFIG.pinCriteria 搜索条件的邮件
 * 移入 inbox 并标记未读，模拟置顶效果
 * 最先运行，避免被后续模块标记已读
 * ========================= */

function pinImportantEmailsToInbox() {
  const results = [];

  if (!CONFIG.pinToInboxEnabled) {
    results.push("Pin to Inbox: 已禁用，跳过");
    return results;
  }

  const criteria = (CONFIG.pinCriteria || []).filter(c => c && c.trim() !== "");

  if (criteria.length === 0) {
    results.push("Pin to Inbox: 没有设置任何搜索条件，跳过");
    return results;
  }

  let totalPinned = 0;

  criteria.forEach((criterion, index) => {
    const query = `${criterion.trim()} -in:inbox newer_than:1d`;
    Logger.log(`Pin criteria ${index + 1}: "${query}"`);

    try {
      const threads = GmailApp.search(query, 0, 20);

      if (threads.length === 0) {
        Logger.log(`Pin criteria ${index + 1}: 没有符合条件的邮件`);
        return;
      }

      threads.forEach(thread => {
        const dedupKey = `PIN::${thread.getId()}`;
        if (isProcessedKey(dedupKey)) {
          Logger.log(`Pin: 跳过已处理 thread：${thread.getFirstMessageSubject()}`);
          return;
        }

        if (!CONFIG.dryRun) {
          thread.moveToInbox();
          thread.markUnread();
          markProcessedKey(dedupKey);
          Logger.log(`Pin: 已置顶 → ${thread.getFirstMessageSubject()}`);
          totalPinned++;
        }
      });

    } catch (e) {
      Logger.log(`Pin criteria ${index + 1} 执行出错：${e}`);
    }
  });

  results.push(`Pin to Inbox: 共置顶 ${totalPinned} 封邮件`);
  return results;
}


/* =========================
 * 1) 分类清理
 * ========================= */

function processConfiguredCategories() {
  const results = [];
  const cats = CONFIG.categories;

  if (cats.purchases.enabled) {
    results.push(`Purchases processed: ${processQueryWithRule('category:purchases is:unread', cats.purchases.action)}`);
  } else {
    results.push("Purchases: skipped");
  }

  if (cats.updates.enabled) {
    results.push(`Updates marked read (older than ${cats.updates.olderThanDays} days): ${processQueryWithRule(`category:updates is:unread older_than:${cats.updates.olderThanDays}d`, cats.updates.action)}`);
  } else {
    results.push("Updates: skipped");
  }

  if (cats.forums.enabled) {
    results.push(`Forums marked read: ${processQueryWithRule('category:forums is:unread', cats.forums.action)}`);
  } else {
    results.push("Forums: skipped");
  }

  if (cats.promotions.enabled) {
    results.push(`Promotions marked read + archived: ${processQueryWithRule('category:promotions is:unread', cats.promotions.action)}`);
  } else {
    results.push("Promotions: skipped");
  }

  if (cats.social.enabled) {
    results.push(`Social marked read (older than ${cats.social.olderThanDays} days): ${processQueryWithRule(`category:social is:unread older_than:${cats.social.olderThanDays}d`, cats.social.action)}`);
  } else {
    results.push("Social: skipped");
  }

  return results;
}

function processQueryWithRule(query, action) {
  let totalProcessed = 0;
  let loops = 0;
  let start = 0;

  while (true) {
    let threads;
    if (CONFIG.dryRun) {
      // Dry-run 模式：邮件没有被真正处理，需要用 start 分页往后翻
      threads = GmailApp.search(query, start, CONFIG.batchSize);
    } else {
      // Non-dry-run 模式：处理完的邮件自动从结果消失，每次从 0 开始即可
      threads = GmailApp.search(query, 0, CONFIG.batchSize);
    }

    if (threads.length === 0) break;

    loops++;
    if (loops > CONFIG.maxLoopsPerQuery) throw new Error(`Safety stop triggered for query: ${query}`);

    const threadsToProcess = [];
    let skippedThisBatch = 0;

    threads.forEach(thread => {
      if (shouldSkipThread(thread)) skippedThisBatch++;
      else threadsToProcess.push(thread);
    });

    if (!CONFIG.dryRun && threadsToProcess.length > 0) {
      applyActionToThreads(threadsToProcess, action);
    }

    totalProcessed += threadsToProcess.length;
    Logger.log(`Query: ${query} | Batch: ${threads.length}, processed: ${threadsToProcess.length}, skipped: ${skippedThisBatch}, loop: ${loops}`);

    if (CONFIG.dryRun) {
      start += CONFIG.batchSize;
      if (threads.length < CONFIG.batchSize) break;
    } else {
      if (threads.length < CONFIG.batchSize) break;
    }
  }

  return totalProcessed;
}

function applyActionToThreads(threads, action) {
  switch (action) {
    case "markRead":
      GmailApp.markThreadsRead(threads);
      break;
    case "markReadAndArchive":
      GmailApp.markThreadsRead(threads);
      GmailApp.moveThreadsToArchive(threads);
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}


/* =========================
 * 2) 自动标签
 * ========================= */

function applyAutoLabels() {
  const results = [];
  const threads = GmailApp.search(CONFIG.autoLabelSearchQuery, 0, CONFIG.autoLabelMaxThreads);
  const labels = ensureAutoLabelsExist();

  let financeCount = 0, schoolCount = 0, workCount = 0, skippedAlreadyAutoLabeled = 0;

  threads.forEach(thread => {
    if (shouldSkipThread(thread)) return;

    const latest = getLatestMessage(thread);
    if (!latest) return;

    const subject = latest.getSubject() || "";
    const body = latest.getPlainBody() || "";
    const from = latest.getFrom() || "";

    const existingLabelNames = getThreadLabelNames(thread);
    if (Array.from(existingLabelNames).some(name => name.startsWith('! AUTO/'))) {
      skippedAlreadyAutoLabeled++;
      return;
    }

    const matchedRuleKey = getHighestPriorityMatchedRule(subject, body, from);
    if (!matchedRuleKey) return;

    if (!CONFIG.dryRun) thread.addLabel(labels[matchedRuleKey]);

    if (matchedRuleKey === "school") schoolCount++;
    else if (matchedRuleKey === "finance") financeCount++;
    else if (matchedRuleKey === "work") workCount++;
  });

  results.push(`! AUTO/Finance labeled: ${financeCount}`);
  results.push(`! AUTO/School labeled: ${schoolCount}`);
  results.push(`! AUTO/Work labeled: ${workCount}`);
  results.push(`Skipped (already had ! AUTO label): ${skippedAlreadyAutoLabeled}`);

  return results;
}

function ensureAutoLabelsExist() {
  return {
    finance: getOrCreateLabel(CONFIG.labelRules.finance.labelName),
    school:  getOrCreateLabel(CONFIG.labelRules.school.labelName),
    work:    getOrCreateLabel(CONFIG.labelRules.work.labelName)
  };
}

function getOrCreateLabel(labelName) {
  return GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);
}

function getThreadLabelNames(thread) {
  return new Set(thread.getLabels().map(label => label.getName()));
}

function getHighestPriorityMatchedRule(subject, body, from) {
  for (const ruleKey of CONFIG.autoLabelPriority) {
    const rule = CONFIG.labelRules[ruleKey];
    if (rule && matchesLabelRule(subject, body, from, rule)) return ruleKey;
  }
  return null;
}

function matchesLabelRule(subject, body, from, rule) {
  const haystack = `${subject}\n${body}\n${from}`.toLowerCase();
  const keywordMatched = (rule.keywords || []).some(k => haystack.includes(k.toLowerCase()));
  const senderMatched = (rule.senderIncludes || []).some(s => from.toLowerCase().includes(s.toLowerCase()));
  return keywordMatched || senderMatched;
}


/* =========================
 * 3) AI 提取动作
 * ========================= */

function buildDailyActionsWithAI() {
  const threads = GmailApp.search(CONFIG.aiSearchQuery, 0, CONFIG.aiMaxThreads);
  const filtered = threads.filter(thread => !shouldSkipThread(thread));

  const emailItems = [];
  let sourceIndex = 1;

  filtered.forEach(thread => {
    const latest = getLatestMessage(thread);
    if (!latest || latest.isStarred()) return;

    emailItems.push({
      source_index: sourceIndex++,
      thread:     thread,
      message:    latest,
      message_id: latest.getId(),
      from:       latest.getFrom() || "",
      subject:    latest.getSubject() || "",
      body:       (latest.getPlainBody() || "").slice(0, CONFIG.aiMaxBodyCharsPerEmail)
    });
  });

  if (emailItems.length === 0) {
    return { must_do: [], schedule_later: [], info_only: [], emailMap: {} };
  }

  const emailMap = {};
  emailItems.forEach(item => { emailMap[item.source_index] = item; });

  if (CONFIG.dryRun && !CONFIG.aiRunInDryMode) {
    return { must_do: [], schedule_later: [], info_only: [], emailMap };
  }

  const prompt = [
    "你是一个高效的个人助理。",
    "请根据下面邮件，提取行动项，并且只输出 JSON。",
    "",
    "要求：",
    "1. 输出必须是合法 JSON",
    "2. 顶层结构必须是：{ \"must_do\": [], \"schedule_later\": [], \"info_only\": [] }",
    "3. 每个对象字段：{ \"source_index\": 1, \"title\": \"xxx\", \"due_date\": \"YYYY-MM-DD 或空字符串\", \"reason\": \"xxx\" }",
    "4. source_index 必须对应邮件编号",
    "5. must_do：需要尽快处理",
    "6. schedule_later：可稍后安排",
    "7. info_only：纯通知、无需行动",
    "8. 不要编造日期；没有明确日期就输出空字符串",
    "9. title 必须是可执行动作，简洁中文",
    "10. 相同或高度相似的任务只保留一条",
    "",
    "以下是邮件：",
    ""
  ].join("\n") + emailItems.map(item =>
    `### EMAIL ${item.source_index}\nFrom: ${item.from}\nSubject: ${item.subject}\nBody:\n${item.body}`
  ).join("\n\n----------------------\n\n");

  if (!CONFIG.geminiApiKey) throw new Error("Gemini API key 未设置，请在 Script Properties 里添加 GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.aiModel}:generateContent?key=${encodeURIComponent(CONFIG.geminiApiKey)}`;

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) throw new Error(`Gemini API error ${status}: ${text}`);

  const json = JSON.parse(text);
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseAiJson(raw);

  parsed.must_do        = dedupeActionItems(Array.isArray(parsed.must_do)        ? parsed.must_do        : []);
  parsed.schedule_later = dedupeActionItems(Array.isArray(parsed.schedule_later)  ? parsed.schedule_later : []);
  parsed.info_only      = dedupeActionItems(Array.isArray(parsed.info_only)       ? parsed.info_only      : []);
  parsed.emailMap = emailMap;

  return parsed;
}

function parseAiJson(raw) {
  return JSON.parse(extractJsonBlock(raw));
}

function extractJsonBlock(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);

  throw new Error("AI 返回内容里找不到合法 JSON");
}

function dedupeActionItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${(item.title || "").trim()}__${(item.due_date || "").trim()}`;
    if (!item.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


/* =========================
 * 4) 执行动作
 * ========================= */

function processAIActionResults(aiResult) {
  const results = [];
  const emailMap = aiResult.emailMap || {};
  let starredCount = 0, taskCount = 0, calendarCount = 0;

  aiResult.must_do.forEach(item => {
    const emailItem = emailMap[item.source_index];
    if (!emailItem) return;

    const uniqueKey = makeDedupeKey("must_do", emailItem.message_id, item.title, item.due_date || "");
    if (isProcessedKey(uniqueKey)) return;

    if (!CONFIG.dryRun) {
      GmailApp.starMessages([emailItem.message]);
      starredCount++;

      if (CONFIG.tasksEnabled) { createGoogleTask(item, "must_do"); taskCount++; }

      if (CONFIG.calendarEnabled && CONFIG.calendarCreateOnlyForMustDo && isValidIsoDate(item.due_date)) {
        createCalendarEntry(item, emailItem);
        calendarCount++;
      }

      markProcessedKey(uniqueKey);
    }
  });

  aiResult.schedule_later.forEach(item => {
    const emailItem = emailMap[item.source_index];
    if (!emailItem) return;

    const uniqueKey = makeDedupeKey("schedule_later", emailItem.message_id, item.title, item.due_date || "");
    if (isProcessedKey(uniqueKey)) return;

    if (!CONFIG.dryRun) {
      if (CONFIG.tasksEnabled) { createGoogleTask(item, "schedule_later"); taskCount++; }
      markProcessedKey(uniqueKey);
    }
  });

  results.push(`Starred must_do messages: ${starredCount}`);
  results.push(`Google Tasks created: ${taskCount}`);
  results.push(`Calendar events created: ${calendarCount}`);

  return results;
}

function createGoogleTask(item, bucket) {
  const taskListId = getOrCreateTaskListId(CONFIG.taskListName);
  const task = {
    title: item.title || "Untitled task",
    notes: `Bucket: ${bucket}\nReason: ${item.reason || ""}\nDue date: ${item.due_date || ""}`
  };
  if (isValidIsoDate(item.due_date)) task.due = `${item.due_date}T09:00:00.000Z`;
  Tasks.Tasks.insert(task, taskListId);
}

function getOrCreateTaskListId(title) {
  const lists = Tasks.Tasklists.list().items || [];
  const existing = lists.find(x => x.title === title);
  if (existing) return existing.id;
  return Tasks.Tasklists.insert({ title }).id;
}

function createCalendarEntry(item, emailItem) {
  const calendar = getOrCreateCalendarByName(CONFIG.calendarName);
  const parts = item.due_date.split("-");
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);

  const timeZone = CalendarApp.getDefaultCalendar().getTimeZone();
  const startTime = new Date(Utilities.formatDate(new Date(year, month, day, 7, 0, 0), timeZone, "yyyy-MM-dd'T'HH:mm:ss"));
  const endTime   = new Date(Utilities.formatDate(new Date(year, month, day, 8, 0, 0), timeZone, "yyyy-MM-dd'T'HH:mm:ss"));

  const gmailRef = `from:(${emailItem.from || ""}) subject:(${emailItem.subject || ""})`;
  calendar.createEvent(`待办：${item.title}`, startTime, endTime, {
    description: `${gmailRef}\n\n\nReason: ${item.reason || ""}\nFrom: ${emailItem.from || ""}\nSubject: ${emailItem.subject || ""}`
  });
}


/* =========================
 * 5) Dashboard
 * ========================= */

function appendActionsToDashboard(aiResult, runStartedAt) {
  if (!CONFIG.dashboardSpreadsheetId) throw new Error("Dashboard Spreadsheet ID 未设置");

  const ss = SpreadsheetApp.openById(CONFIG.dashboardSpreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.dashboardSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.dashboardSheetName);
    sheet.appendRow(["Run Time","Bucket","Title","Due Date","Reason","Source Index","From","Subject"]);
  }

  const emailMap = aiResult.emailMap || {};
  const rows = [];

  ["must_do","schedule_later","info_only"].forEach(bucket => {
    (aiResult[bucket] || []).forEach(item => {
      const e = emailMap[item.source_index] || {};
      rows.push([runStartedAt, bucket, item.title||"", item.due_date||"", item.reason||"", item.source_index||"", e.from||"", e.subject||""]);
    });
  });

  if (rows.length > 0 && !CONFIG.dryRun) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}


/* =========================
 * 6) 格式化邮件摘要
 * ========================= */

function formatActionDigest(aiResult) {
  const parts = ["今日待办（来自邮件）", ""];

  const formatSection = (label, items) => {
    parts.push(label);
    if (!items.length) {
      parts.push("- 无");
    } else {
      items.forEach(x => parts.push(`- ${x.title}${x.due_date ? `（截止 ${x.due_date}）` : ""}`));
    }
    parts.push("");
  };

  formatSection("必做：", aiResult.must_do || []);
  formatSection("可安排：", aiResult.schedule_later || []);

  parts.push("信息类（无需处理）：");
  if (!(aiResult.info_only || []).length) {
    parts.push("- 无");
  } else {
    (aiResult.info_only || []).forEach(x => parts.push(`- ${x.title || "无需处理"}`));
  }

  return parts.join("\n");
}


/* =========================
 * 7) 去重
 * ========================= */

function makeDedupeKey(bucket, messageId, title, dueDate) {
  return `DEDUP::${bucket}::${messageId}::${title}::${dueDate || ""}`;
}

function markProcessedKey(key) {
  PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
}

function isProcessedKey(key) {
  return !!PropertiesService.getScriptProperties().getProperty(key);
}

function cleanupOldDedupeKeys() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  const maxAge = CONFIG.dedupeRetentionDays * 24 * 60 * 60 * 1000;

  Object.keys(all).forEach(key => {
    if (!key.startsWith("DEDUP::") && !key.startsWith("PIN::")) return;
    const ts = Number(all[key] || 0);
    if (!ts || now - ts > maxAge) props.deleteProperty(key);
  });
}


/* =========================
 * 8) 通用工具函数
 * ========================= */

function getLatestMessage(thread) {
  const messages = thread.getMessages();
  return messages?.length ? messages[messages.length - 1] : null;
}

function shouldSkipThread(thread) {
  const latest = getLatestMessage(thread);
  if (!latest) return false;

  // 跳过带特殊处理标签的邮件，交给对应模块处理
  const labelNames = getThreadLabelNames(thread);
  if (labelNames.has('! Call')) {
    Logger.log(`Skipped thread due to ! Call label: ${latest.getSubject()}`);
    return true;
  }

  const fromEmail = extractEmailAddress(latest.getFrom());
  if (isWhitelistedSender(fromEmail)) {
    Logger.log(`Skipped thread due to whitelist sender: ${fromEmail}`);
    return true;
  }
  return false;
}

function extractEmailAddress(fromRaw) {
  const match = fromRaw.match(/<([^>]+)>/);
  return match?.[1] ? match[1].toLowerCase().trim() : fromRaw.toLowerCase().trim();
}

function isWhitelistedSender(email) {
  const normalized = email.toLowerCase();
  return CONFIG.whitelistSenders.some(item => normalized.includes(item.toLowerCase().trim()));
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getOrCreateCalendarByName(name) {
  const existing = CalendarApp.getAllOwnedCalendars().find(c => c.getName() === name);
  if (existing) return existing;
  Logger.log(`Calendar "${name}" not found, creating...`);
  return CalendarApp.createCalendar(name, {
    summary: name,
    timeZone: CalendarApp.getDefaultCalendar().getTimeZone()
  });
}

function sendExecutionSummaryEmail(bodyText, subject) {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), subject, bodyText);
}

function sendErrorAlert(error) {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), "Gmail Auto Clean v6.2 Error", [
    "脚本运行出错。",
    "",
    `Time: ${new Date()}`,
    `Error: ${error?.message || error}`,
    "",
    "Stack:",
    error?.stack || "(no stack)"
  ].join("\n"));
}

function validateAutoLabelConfig() {
  const priorityKeys = CONFIG.autoLabelPriority;
  const ruleKeys = Object.keys(CONFIG.labelRules);

  priorityKeys.forEach(key => {
    if (!CONFIG.labelRules[key]) throw new Error(`Config 错误：autoLabelPriority 里有 "${key}"，但 labelRules 里找不到对应规则。`);
  });

  ruleKeys.forEach(key => {
    if (!priorityKeys.includes(key)) throw new Error(`Config 错误：labelRules 里有 "${key}"，但没有加入 autoLabelPriority，这个规则永远不会被执行。`);
  });

  Logger.log("validateAutoLabelConfig: OK");
}


/* =========================
 * Complete All AUTO Tasks
 * 将 ! AUTO Tasks 列表里所有未完成的 task 标记为已完成
 * ========================= */

function completeAllAutoTasks() {
  const taskListId = getOrCreateTaskListId(CONFIG.taskListName);

  let completedCount = 0;
  let pageToken = null;

  do {
    const params = { showCompleted: false, showHidden: false, maxResults: 100 };
    if (pageToken) params.pageToken = pageToken;

    const response = Tasks.Tasks.list(taskListId, params);
    const tasks = response.items || [];

    tasks.forEach(task => {
      if (task.status !== "completed") {
        Tasks.Tasks.update(
          { ...task, status: "completed" },
          taskListId,
          task.id
        );
        completedCount++;
      }
    });

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  Logger.log(`completeAllAutoTasks: 已完成 ${completedCount} 个 tasks`);
  return completedCount;
}

/***********************
 * Calendar API - add this to your existing Gmail Auto Clean Apps Script
 * Exposes calendar data as JSON for the calendar dashboard
 *
 * Setup:
 * 1. Paste this file's contents into your existing Apps Script project
 * 2. In Script Properties, add: DASHBOARD_TOKEN = <any long random string>
 * 3. Deploy > New Deployment > Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL and store it as APPS_SCRIPT_URL in your Cloudflare Worker secret
 ***********************/

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('DASHBOARD_TOKEN');
  if (!token || e.parameter.token !== token) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const action = e.parameter.action;

  if (action === 'calendars') {
    return handleGetCalendars();
  } else if (action === 'events') {
    return handleGetEvents(e.parameter);
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
}

function handleGetCalendars() {
  const calendars = CalendarApp.getAllCalendars();
  const result = calendars.map(cal => ({
    id: cal.getId(),
    name: cal.getName(),
    color: cal.getColor(),
  }));
  return jsonResponse(result);
}

function handleGetEvents(params) {
  if (!params.start || !params.end) {
    return jsonResponse({ error: 'Missing start or end' }, 400);
  }

  const start = new Date(params.start);
  const end = new Date(params.end);
  // Extend end to end of day
  end.setHours(23, 59, 59, 999);

  const allEvents = [];
  const calendars = CalendarApp.getAllCalendars();

  for (const cal of calendars) {
    try {
      const events = cal.getEvents(start, end);
      for (const event of events) {
        allEvents.push({
          id: event.getId(),
          title: event.getTitle(),
          start: event.getStartTime().toISOString(),
          end: event.getEndTime().toISOString(),
          allDay: event.isAllDayEvent(),
          description: event.getDescription() || '',
          location: event.getLocation() || '',
          calendarId: cal.getId(),
          calendarName: cal.getName(),
          color: cal.getColor(),
        });
      }
    } catch (err) {
      // Skip calendars that throw (e.g. read-only external calendars)
      Logger.log('Skipping calendar ' + cal.getName() + ': ' + err);
    }
  }

  return jsonResponse(allEvents);
}

function jsonResponse(data, status) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}



