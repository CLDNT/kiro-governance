-- Migration: V003a__checkpoint_seeds_patch
-- Date: 2026-06-30
-- Purpose: Add executive/planning checkpoint seeds missing from V003
-- Idempotency: All statements use ON CONFLICT DO NOTHING

-- Phase 1: Kickoff Prep Meeting
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Prep Meeting', 5, 'meeting', false, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Prep Meeting', 5, 'meeting', false, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 3: Executive Check-in Call 1
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Executive Check-in Call 1', 3, 'meeting', false, 'default'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Executive Check-in Call 1', 3, 'meeting', false, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 4: Executive Check-in Call 2
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 7, 'meeting', false, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 7, 'meeting', false, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 4: Account Planning Session
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Account Planning Session', 8, 'meeting', false, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Account Planning Session', 8, 'meeting', false, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 4: Closure checkpoints (for project closure workflow)
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Request Signoff from Business Ops', 9, 'checklist', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Request Signoff from Business Ops', 9, 'checklist', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff with Customer', 10, 'checklist', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff with Customer', 10, 'checklist', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Closure Meeting/Email', 11, 'checklist', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Closure Meeting/Email', 11, 'checklist', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Create Project Closure Deck', 12, 'checklist', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Create Project Closure Deck', 12, 'checklist', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;
