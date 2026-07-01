"use strict";
/**
 * Config domain types — CASDM templates and analysis prompts
 * Source: docs/phase2/config-architecture.md §7
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKPOINT_TYPES = exports.CONFIG_TYPES = exports.PROJECT_TYPES = void 0;
// Enums matching database constraints
exports.PROJECT_TYPES = ['AppDev', 'AppMod', 'AIML', 'default'];
exports.CONFIG_TYPES = ['phase', 'micro_artifact', 'macro_checkpoint'];
exports.CHECKPOINT_TYPES = ['human_review', 'meeting', 'transcript_analysis', 'checklist'];
