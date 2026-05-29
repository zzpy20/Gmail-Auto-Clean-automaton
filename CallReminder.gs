/***********************
 * Call Reminder v2.1
 * 功能：
 * - 每1分钟检查 Gmail 里带有 "! Call" 标签的未读邮件
 * - 自动在 Google Calendar "Call" 里创建1小时事件
 * - 事件时间：当天 7pm（如果现在已过 7pm 则安排次日 7pm）
 * - 事件标题：邮件 subject（最多30字符）
 * - 事件备注：顶部 Gmail 搜索字符串方便定位原邮件 + AI 生成摘要
 * - 处理完自动移除 "! Call" 标签 + 添加 "! Call - Done" + 标记已读
 * - 去重：同一封邮件不会重复创建事件
 *
 * 注意：isProcessedKey / markProcessedKey / getOrCreateCalendarByName
 * 这三个工具函数定义在 Code.gs 里，这里直接共用。
 ***********************/

const CALL_REMINDER_CONFIG = {
  labelName: "! Call",
  labelDoneName: "! Call - Done",
  calendarName: "Call",
  eventStartHour: 19,     // 7pm
  eventDurationHours: 1,
  titleMaxLength: 30,
  dryRun: false
};


/* =========================
 * 主函数
 * ========================= */

function checkCallLabelAndCreateEvent() {
  cleanupOldCallReminders(); // ← 加这一行
  const label = GmailApp.getUserLabelByName(CALL_REMINDER_CONFIG.labelName);
  if (!label) {
    Logger.log(`标签 "${CALL_REMINDER_CONFIG.labelName}" 不存在，请先在 Gmail 里创建它`);
    return;
  }

  const doneLabel = GmailApp.getUserLabelByName(CALL_REMINDER_CONFIG.labelDoneName)
    || GmailApp.createLabel(CALL_REMINDER_CONFIG.labelDoneName);

  const threads = GmailApp.search(`label:!-Call is:unread`, 0, 20);

  if (threads.length === 0) {
    Logger.log("没有发现新的 ! Call 未读邮件");
    return;
  }

  const calendar = getOrCreateCalendarByName(CALL_REMINDER_CONFIG.calendarName);
  Logger.log(`发现 ${threads.length} 封 ! Call 未读邮件`);

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const latest = messages[messages.length - 1];
    if (!latest) return;

    const messageId = latest.getId();

    const dedupKey = `CALLREMINDER::${messageId}`;
    if (isProcessedKey(dedupKey)) {
      Logger.log(`跳过已处理邮件：${latest.getSubject()}`);
      return;
    }

    const subject = latest.getSubject() || "No Subject";
    const body = latest.getPlainBody() || "";
    const from = latest.getFrom() || "";

    const eventTitle = subject.length > CALL_REMINDER_CONFIG.titleMaxLength
      ? subject.substring(0, CALL_REMINDER_CONFIG.titleMaxLength)
      : subject;

    const gmailRef = `from:(${from}) subject:(${subject})`;
    const eventDescription = `${gmailRef}\n\n\n${generateCallSummary(subject, body, from)}`;

    const { startTime, endTime } = calculateEventTime();

    Logger.log(`准备创建 Calendar 事件：${eventTitle} at ${startTime}`);

    if (!CALL_REMINDER_CONFIG.dryRun) {
      calendar.createEvent(eventTitle, startTime, endTime, { description: eventDescription });
      Logger.log(`Calendar 事件已创建：${eventTitle}`);

      markProcessedKey(dedupKey);
      thread.removeLabel(label);
      thread.addLabel(doneLabel);
      thread.markRead();
      Logger.log(`已移除 ! Call、添加 ! Call - Done 并标记已读：${subject}`);
    }
  });
}


/* =========================
 * AI 摘要生成
 * 用 Gemini 把邮件压缩成2-3句话
 * 失败则 fallback 到原文前300字
 * ========================= */

function generateCallSummary(subject, body, from) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    Logger.log("GEMINI_API_KEY 未设置，使用 fallback description");
    return buildFallbackDescription(from, subject, body);
  }

  const prompt = [
    "以下是一封需要回电或跟进的邮件。",
    "请用2-3句话总结：需要做什么、谁发的、有没有截止时间或紧急程度。",
    "不要用标题、列表或任何格式，直接写句子，语言简洁清晰。",
    "",
    `From: ${from}`,
    `Subject: ${subject}`,
    `Body:`,
    body.slice(0, 800)
  ].join("\n");

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      Logger.log(`Gemini API 错误 ${status}，使用 fallback description`);
      return buildFallbackDescription(from, subject, body);
    }

    const json = JSON.parse(response.getContentText());
    const summary = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!summary) {
      Logger.log("Gemini 返回内容为空，使用 fallback description");
      return buildFallbackDescription(from, subject, body);
    }

    Logger.log(`AI 摘要生成成功：${summary.slice(0, 80)}...`);
    return summary;

  } catch (e) {
    Logger.log(`generateCallSummary 异常：${e}，使用 fallback description`);
    return buildFallbackDescription(from, subject, body);
  }
}


/* =========================
 * Fallback description
 * AI 失败时使用，保留原始信息前300字
 * ========================= */

function buildFallbackDescription(from, subject, body) {
  return [`From: ${from}`, `Subject: ${subject}`, ``, body.slice(0, 300)].join("\n");
}


/* =========================
 * 计算事件时间
 * 今天 7pm；如果已过 7pm 则明天 7pm
 * ========================= */

function calculateEventTime() {
  const now = new Date();
  const timeZone = CalendarApp.getDefaultCalendar().getTimeZone();

  const currentHour = parseInt(Utilities.formatDate(now, timeZone, "H"));
  const daysToAdd = currentHour >= CALL_REMINDER_CONFIG.eventStartHour ? 1 : 0;

  const targetDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const dateStr = Utilities.formatDate(targetDate, timeZone, "yyyy-MM-dd");
  const hourStr = String(CALL_REMINDER_CONFIG.eventStartHour).padStart(2, "0");

  const startTime = new Date(`${dateStr}T${hourStr}:00:00`);
  const endTime = new Date(startTime.getTime() + CALL_REMINDER_CONFIG.eventDurationHours * 60 * 60 * 1000);

  return { startTime, endTime };
}


/* =========================
 * Trigger 设置
 * 只需手动运行一次
 * ========================= */

function setupCallReminderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "checkCallLabelAndCreateEvent")
    .forEach(t => { ScriptApp.deleteTrigger(t); Logger.log("已删除旧的 trigger"); });

  ScriptApp.newTrigger("checkCallLabelAndCreateEvent")
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log("Trigger 设置成功：每1分钟自动检查 ! Call 标签");
}

function cleanupOldCallReminders() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  const maxAge = 45 * 24 * 60 * 60 * 1000;

  let deletedCount = 0;
  Object.keys(all).forEach(key => {
    if (!key.startsWith("CALLREMINDER::")) return;
    const ts = Number(all[key] || 0);
    if (!ts || now - ts > maxAge) {
      props.deleteProperty(key);
      deletedCount++;
    }
  });

  if (deletedCount > 0) Logger.log(`cleanupOldCallReminders: 删除 ${deletedCount} 条旧记录`);
}
