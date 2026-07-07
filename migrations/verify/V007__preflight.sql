-- V007__preflight.sql — READ-ONLY. Run BEFORE an intentional V007 apply and review the counts.
-- No DELETE / UPDATE / INSERT. Reports what the cleanup WOULD remove and what it preserves.
--
--   to_delete_projects : imported CST-* (non-template) projects the DELETE would remove
--   preserved_template : the CASDM '__template__' row (must remain = 1)
--   preserved_dp       : DP-* projects (must be unchanged by the cleanup)
--   governance_events  : append-only audit rows (must be unchanged by the cleanup)

SELECT 'to_delete_projects' AS metric, count(*) AS value
  FROM projects WHERE jira_key LIKE 'CST-%' AND jira_key <> '__template__'
UNION ALL SELECT 'preserved_template', count(*) FROM projects WHERE jira_key = '__template__'
UNION ALL SELECT 'preserved_dp',        count(*) FROM projects WHERE jira_key LIKE 'DP-%'
UNION ALL SELECT 'governance_events',   count(*) FROM governance_events;
