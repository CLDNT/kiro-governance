-- V007__verify.sql — READ-ONLY. Run AFTER an intentional V007 apply.
-- No DELETE / UPDATE / INSERT. Asserts the cleanup left the DB in the expected state.
--
--   to_delete_remaining : imported CST-* (non-template) projects still present — MUST be 0
--   preserved_template  : the CASDM '__template__' row — MUST be 1
--   preserved_dp        : DP-* projects — MUST match the preflight count (unchanged)
--   governance_events   : append-only audit rows — MUST match the preflight count (unchanged)
--
-- Compare preserved_dp / governance_events against the preflight run's values (unchanged).

SELECT
  'to_delete_remaining' AS metric,
  count(*)              AS value,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
  FROM projects WHERE jira_key LIKE 'CST-%' AND jira_key <> '__template__'
UNION ALL
SELECT
  'preserved_template',
  count(*),
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM projects WHERE jira_key = '__template__'
UNION ALL
SELECT 'preserved_dp',      count(*), 'COMPARE_TO_PREFLIGHT' FROM projects WHERE jira_key LIKE 'DP-%'
UNION ALL
SELECT 'governance_events', count(*), 'COMPARE_TO_PREFLIGHT' FROM governance_events;
