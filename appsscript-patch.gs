/*
 * Gmail Auto Clean v6.2 — Dashboard Patch
 *
 * Apply 4 changes to your existing Apps Script, then add the new functions below.
 *
 * CHANGE 1 — gmailAutoCleanV62()
 *   Replace the entire function with the version below.
 *   Key differences:
 *     · Adds DASHBOARD_URL constant and prepends it to the summary email.
 *     · Declares labelResults / actionResults outside their if-blocks so stats can be read.
 *     · Calls saveLatestRunToProperties() after the Dashboard step.
 *
 * CHANGE 2 — buildDailyActionsWithAI()
 *   Find this single line:
 *     emailItems.forEach(item => { emailMap[item.source_index] = item; });
 *   Replace it with:
 *     emailItems.forEach(item => {
 *       item.thread_id = item.thread.getId();
 *       emailMap[item.source_index] = item;
 *     });
 *
 * CHANGE 3 — doGet()
 *   Inside the if/else chain for `action`, add a new branch before the final return:
 *     } else if (action === 'latest_run') {
 *       return handleGetLatestRun();
 *     }
 *
 * CHANGE 4 — Add the new functions below to the bottom of your script.
 */


/* =====================================================================
 * CHANGE 1 — complete replacement for gmailAutoCleanV62()
 * ===================================================================== */

function gmailAutoCleanV62() {
  const DASHBOARD_URL = 'https://dash-gmail.1000600.xyz';
  const runStartedAt = new Date();
  const executionSummary = [];

  try {
    validateAutoLabelConfig();
    cleanupOldDedupeKeys();

    executionSummary.push(`Run time: ${runStartedAt}`);
    executionSummary.push(`Dry run: ${CONFIG.dryRun}`);
    executionSummary.push(`AI runs in dry mode: ${CONFIG.aiRunInDryMode}`);

    // 0) Pin to Inbox — runs first so later steps don't mark these read
    const pinResults = pinImportantEmailsToInbox();
    executionSummary.push("=== Pin to Inbox ===");
    pinResults.forEach(line => executionSummary.push(line));

    // 1) Category cleaning
    const categoryResults = processConfiguredCategories();
    executionSummary.push("=== Category Processing ===");
    categoryResults.forEach(line => executionSummary.push(line));

    // 2) Auto labels — declared outside block so extractNum can use it later
    let labelResults = [];
    if (CONFIG.autoLabelsEnabled) {
      labelResults = applyAutoLabels();
      executionSummary.push("=== Auto Labels ===");
      labelResults.forEach(line => executionSummary.push(line));
    }

    // 3) AI extraction
    let aiResult = null;
    if (CONFIG.aiEnabled) {
      aiResult = buildDailyActionsWithAI();
      executionSummary.push("=== AI Actions ===");
      executionSummary.push(`Must do: ${aiResult.must_do.length}`);
      executionSummary.push(`Schedule later: ${aiResult.schedule_later.length}`);
      executionSummary.push(`Info only: ${aiResult.info_only.length}`);
    }

    // 4) Execute AI actions — declared outside block so extractNum can use it later
    let actionResults = [];
    if (aiResult) {
      actionResults = processAIActionResults(aiResult);
      executionSummary.push("=== AI Action Execution ===");
      actionResults.forEach(line => executionSummary.push(line));

      // 5) Google Sheets dashboard
      if (CONFIG.dashboardEnabled) {
        appendActionsToDashboard(aiResult, runStartedAt);
        executionSummary.push("Dashboard updated.");
      }

      // 5b) Save serialisable run data to Script Properties for the web dashboard
      saveLatestRunToProperties({
        run_time: runStartedAt.toISOString(),
        dry_run:  CONFIG.dryRun,
        stats: {
          pin_to_inbox:        extractNum(pinResults,      /(\d+)\s*封邮件/),
          updates_marked_read: extractNum(categoryResults, /Updates.*?:\s*(\d+)/),
          forums_marked_read:  extractNum(categoryResults, /Forums.*?:\s*(\d+)/),
          promotions_archived: extractNum(categoryResults, /Promotions.*?:\s*(\d+)/),
          social_marked_read:  extractNum(categoryResults, /Social.*?:\s*(\d+)/),
          finance_labeled:     extractNum(labelResults,    /Finance labeled:\s*(\d+)/),
          school_labeled:      extractNum(labelResults,    /School labeled:\s*(\d+)/),
          work_labeled:        extractNum(labelResults,    /Work labeled:\s*(\d+)/),
          starred_count:       extractNum(actionResults,   /Starred.*?:\s*(\d+)/),
          tasks_created:       extractNum(actionResults,   /Tasks created:\s*(\d+)/),
          calendar_events:     extractNum(actionResults,   /Calendar events.*?:\s*(\d+)/),
        },
        must_do:        buildSerializableItems(aiResult.must_do,        aiResult.emailMap),
        schedule_later: buildSerializableItems(aiResult.schedule_later, aiResult.emailMap),
        info_only:      buildSerializableItems(aiResult.info_only,      aiResult.emailMap),
      });
    }

    // 6) Summary email — dashboard link prepended
    if (CONFIG.sendExecutionSummaryEmail) {
      let body = `View dashboard: ${DASHBOARD_URL}\n\n` + executionSummary.join("\n");
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


/* =====================================================================
 * CHANGE 4 — New functions: paste these at the bottom of your script
 * ===================================================================== */

/**
 * Returns the stored latest-run JSON via the web app endpoint.
 * Used by: doGet() when action === 'latest_run'
 */
function handleGetLatestRun() {
  const raw = PropertiesService.getScriptProperties().getProperty('LATEST_RUN_DATA');
  if (!raw) return jsonResponse({ error: 'No data yet — run gmailAutoCleanV62 first.' }, 404);
  try {
    return jsonResponse(JSON.parse(raw));
  } catch (e) {
    return jsonResponse({ error: 'Stored data is corrupted.' }, 500);
  }
}

/**
 * Converts AI result items into plain objects safe for JSON serialisation.
 * Picks up thread_id set by the CHANGE 2 patch in buildDailyActionsWithAI.
 */
function buildSerializableItems(items, emailMap) {
  return (items || []).map(item => {
    const e = emailMap[item.source_index] || {};
    return {
      title:     item.title    || '',
      due_date:  item.due_date || '',
      reason:    item.reason   || '',
      from:      e.from        || '',
      subject:   e.subject     || '',
      thread_id: e.thread_id   || '',
    };
  });
}

/**
 * Persists the full run snapshot to Script Properties.
 * Limit: 500 KB total properties storage. A typical run is ~5–15 KB.
 */
function saveLatestRunToProperties(data) {
  const json = JSON.stringify(data);
  PropertiesService.getScriptProperties().setProperty('LATEST_RUN_DATA', json);
  Logger.log(`Saved latest run data to Script Properties (${json.length} bytes).`);
}

/**
 * Scans an array of result-line strings for the first regex match and returns
 * the captured integer, or 0 if no match is found.
 */
function extractNum(lines, regex) {
  for (const line of (lines || [])) {
    const m = String(line).match(regex);
    if (m && m[1]) return parseInt(m[1]) || 0;
  }
  return 0;
}
