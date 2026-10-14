const { sequelize } = require('../../db/models');
const { currentPrompts } = require('./log');
const { lastReadSettings } = require('../settings/settings');

// How each prompt version performs (SYSTEM_4 D2, E4-26): one row per prompt and version from the AI call log —
// calls by status, time, tokens, confidence, and how often the AI was unsure (at or below the threshold). Old and
// new versions of a prompt side by side are the before / after of a prompt change. Read-only.

const SUMMARY_SQL = `
  SELECT prompt_name, prompt_version,
         MIN(created_at) AS first_call, MAX(created_at) AS last_call,
         COUNT(*)::int AS calls,
         COUNT(*) FILTER (WHERE status = 'ok')::int AS ok,
         COUNT(*) FILTER (WHERE status = 'error')::int AS error,
         COUNT(*) FILTER (WHERE status = 'timeout')::int AS timeout,
         COUNT(*) FILTER (WHERE status = 'too_long')::int AS too_long,
         AVG(duration_ms) FILTER (WHERE status = 'ok') AS avg_duration_ms,
         AVG(prompt_tokens) AS avg_prompt_tokens,
         AVG(completion_tokens) AS avg_completion_tokens,
         AVG(confidence) AS avg_confidence,
         COUNT(confidence)::int AS with_confidence,
         COUNT(*) FILTER (WHERE confidence <= :threshold)::int AS unsure
  FROM ulink_llm_calls
  WHERE (:since::timestamptz IS NULL OR created_at >= :since::timestamptz)
  GROUP BY prompt_name, prompt_version`;

const num = (v, digits = 0) => (v == null ? null : Number(Number(v).toFixed(digits)));

// rows: the query's rows. Adds the prompts on this server with no calls yet; marks which version is current;
// newest version first within a prompt.
function toSummary(rows, current, threshold) {
  const currentVersions = new Set(current.map((p) => p.promptVersion));
  const seen = new Set(rows.map((r) => r.prompt_version));
  const prompts = rows.map((r) => ({
    promptName: r.prompt_name,
    promptVersion: r.prompt_version,
    current: currentVersions.has(r.prompt_version),
    firstCall: r.first_call,
    lastCall: r.last_call,
    calls: r.calls,
    byStatus: { ok: r.ok, error: r.error, timeout: r.timeout, too_long: r.too_long },
    avgDurationMs: num(r.avg_duration_ms),
    avgPromptTokens: num(r.avg_prompt_tokens),
    avgCompletionTokens: num(r.avg_completion_tokens),
    avgConfidence: num(r.avg_confidence, 3),
    // Share of the calls that gave a confidence where it was at or below the threshold.
    unsureShare: r.with_confidence ? num(r.unsure / r.with_confidence, 3) : null,
  }));
  for (const p of current) {
    if (!seen.has(p.promptVersion)) {
      prompts.push({ promptName: p.promptName, promptVersion: p.promptVersion, current: true, firstCall: null, lastCall: null, calls: 0, byStatus: { ok: 0, error: 0, timeout: 0, too_long: 0 }, avgDurationMs: null, avgPromptTokens: null, avgCompletionTokens: null, avgConfidence: null, unsureShare: null });
    }
  }
  prompts.sort((a, b) => String(a.promptName).localeCompare(String(b.promptName))
    || Number(b.current) - Number(a.current)
    || String(b.lastCall ?? '').localeCompare(String(a.lastCall ?? '')));
  return { threshold, prompts };
}

// days: only calls from the last N days; null = all time.
async function promptSummary({ days = null } = {}) {
  const threshold = lastReadSettings().aiConfidenceThreshold;
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
  const rows = await sequelize.query(SUMMARY_SQL, { replacements: { threshold, since }, type: sequelize.QueryTypes.SELECT });
  return toSummary(rows, currentPrompts(), threshold);
}

module.exports = { promptSummary, toSummary };
