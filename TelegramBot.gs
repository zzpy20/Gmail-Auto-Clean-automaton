/***********************
 * Telegram Bot v2.0 - Polling 模式
 * 每分钟主动拉取 Telegram 消息，不需要 Web App
 *
 * 指令：
 * /run    - 立刻触发 Gmail Auto Clean
 * /call   - 立刻检查 ! Call 标签
 * /help   - 显示所有指令
 *
 * Script Properties 需要设置：
 * - TELEGRAM_BOT_TOKEN
 * - TELEGRAM_CHAT_ID
 ***********************/

const TELEGRAM_CONFIG = {
  botToken: PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN"),
  chatId:   PropertiesService.getScriptProperties().getProperty("TELEGRAM_CHAT_ID")
};


/* =========================
 * 主函数：拉取并处理新消息
 * 每分钟由 trigger 自动运行
 * ========================= */

function pollTelegramMessages() {
  const props = PropertiesService.getScriptProperties();
  const lastUpdateId = parseInt(props.getProperty("TELEGRAM_LAST_UPDATE_ID") || "0");

  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`,
    { method: "get", muteHttpExceptions: true }
  );

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    Logger.log(`Telegram getUpdates error ${status}: ${response.getContentText()}`);
    return;
  }

  const data = JSON.parse(response.getContentText());
  if (!data.ok || !data.result?.length) {
    Logger.log("没有新消息");
    return;
  }

  data.result.forEach(update => {
    props.setProperty("TELEGRAM_LAST_UPDATE_ID", String(update.update_id));

    const message = update.message;
    if (!message) return;

    const chatId = String(message?.chat?.id);
    const text = (message?.text || "").trim();

    // 安全检查：只响应你自己的 chat
    if (chatId !== TELEGRAM_CONFIG.chatId) {
      Logger.log(`拒绝来自未知 chat ID 的消息：${chatId}`);
      return;
    }

    Logger.log(`收到指令：${text}`);
    handleCommand(text);
  });
}


/* =========================
 * 处理指令
 * ========================= */

function handleCommand(text) {
  switch (text) {
    case "/run":
      sendTelegramMessage("正在运行 Gmail Auto Clean，请稍候...");
      gmailAutoCleanV62();
      sendTelegramMessage("Gmail Auto Clean 运行完成！");
      break;

    case "/call":
      sendTelegramMessage("正在检查 ! Call 标签...");
      checkCallLabelAndCreateEvent();
      sendTelegramMessage("! Call 检查完成！");
      break;

    // ✅ 新增这个 case ↓
    case "/donetasks":
      sendTelegramMessage("正在将所有 ! AUTO Tasks 标记为已完成...");
      const count = completeAllAutoTasks();
      sendTelegramMessage(`✅ 完成！共标记了 ${count} 个 tasks 为已完成。`);
      break;
    
    case "/help":
      sendTelegramMessage([
        "可用指令：",
        "",
        "/run  - 立刻运行 Gmail Auto Clean",
        "/call - 立刻检查 ! Call 标签并创建 Calendar 事件",
        "/donetasks - 将所有 ! AUTO Tasks 标记为已完成",
        "/help - 显示此帮助信息"
      ].join("\n"));
      break;

    default:
      sendTelegramMessage(`未知指令：${text}\n发送 /help 查看所有指令`);
  }
}


/* =========================
 * 发送 Telegram 消息
 * ========================= */

function sendTelegramMessage(text) {
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/sendMessage`,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: TELEGRAM_CONFIG.chatId, text }),
      muteHttpExceptions: true
    }
  );

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Telegram API error ${status}: ${response.getContentText()}`);
  }

  Logger.log(`Telegram 消息发送成功：${text}`);
}


/* =========================
 * Trigger 设置
 * 只需手动运行一次
 * ========================= */

function setupTelegramPollingTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "pollTelegramMessages")
    .forEach(t => { ScriptApp.deleteTrigger(t); Logger.log("已删除旧的 trigger"); });

  ScriptApp.newTrigger("pollTelegramMessages")
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log("Polling trigger 设置成功：每分钟自动检查 Telegram 消息");
  sendTelegramMessage("Telegram Bot 已启动！发送 /help 查看所有指令。");
}
