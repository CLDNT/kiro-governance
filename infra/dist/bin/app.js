"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const governance_stack_1 = require("../stacks/governance-stack");
const deliverpro_stack_1 = require("../stacks/deliverpro-stack");
const app = new cdk.App();
// Phase 1: Governance infrastructure
new governance_stack_1.GovernanceStack(app, 'KiroGovernanceStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1',
    },
    description: 'Kiro Governance — Phase 1 + Phase 2 Data & Persistence (RDS PostgreSQL + EC2 MCP Server)',
});
// Phase 2: DeliverPro application infrastructure
new deliverpro_stack_1.DeliverProStack(app, 'DeliverProStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'us-east-1',
    },
    description: 'DeliverPro — Phase 2 Application Infrastructure (Cognito, API Gateway, CloudFront, S3)',
    environment: 'dev',
});
app.synth();
