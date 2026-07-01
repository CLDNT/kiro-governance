"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.closePool = closePool;
exports.query = query;
exports.queryOne = queryOne;
exports.queryMany = queryMany;
const rds_signer_1 = require("@aws-sdk/rds-signer");
const pg_1 = require("pg");
let pool = null;
let tokenExpiry = 0;
let signer = null;
/**
 * Initialize RDS Signer for IAM database authentication.
 * Signer is created once and reused across all token refreshes.
 *
 * Configuration from environment:
 * - DB_ENDPOINT: RDS endpoint hostname
 * - DB_PORT: RDS port (default 5432)
 * - DB_USER: IAM database user
 * - AWS_REGION: AWS region for signer
 */
function initSigner() {
    if (!signer) {
        signer = new rds_signer_1.Signer({
            hostname: process.env.DB_ENDPOINT,
            port: Number(process.env.DB_PORT || 5432),
            username: process.env.DB_USER,
            region: process.env.AWS_REGION,
        });
    }
    return signer;
}
/**
 * Get or create database connection pool with RDS IAM token.
 *
 * Token lifecycle:
 * - Generated with 15-minute TTL
 * - Refreshed when within 1 minute of expiry (14-minute refresh window)
 * - Pool is closed and recreated when token is refreshed
 *
 * Configuration from environment:
 * - DB_ENDPOINT: RDS cluster endpoint
 * - DB_PORT: Port (default 5432)
 * - DB_NAME: Database name
 * - DB_USER: IAM database user
 * - AWS_REGION: For token generation
 *
 * @returns Promise<Pool> - Connected and ready PostgreSQL pool
 */
async function getPool() {
    const now = Date.now();
    // Refresh token if within 1 minute of expiry or first call
    if (now >= tokenExpiry) {
        const signer_ = initSigner();
        const token = await signer_.getAuthToken();
        tokenExpiry = now + 14 * 60 * 1000; // 14 minutes from now
        // Close existing pool before creating new one
        if (pool) {
            try {
                await pool.end();
            }
            catch (err) {
                console.warn('[db.pool] Error closing old pool', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        pool = new pg_1.Pool({
            host: process.env.DB_ENDPOINT,
            port: Number(process.env.DB_PORT || 5432),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: token,
            ssl: { rejectUnauthorized: true },
            max: 5, // Max connections in pool
            idleTimeoutMillis: 30000, // Idle connection timeout
            connectionTimeoutMillis: 5000,
        });
        console.log('[db.pool] Created new pool with refreshed IAM token');
    }
    return pool;
}
/**
 * Close the database pool gracefully.
 * Call this during Lambda shutdown or in test cleanup.
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        tokenExpiry = 0;
        console.log('[db.pool] Closed pool');
    }
}
/**
 * Execute a query with automatic connection pooling and token refresh.
 *
 * @param queryStr - SQL query string (use $1, $2, etc. for parameters)
 * @param values - Query parameters (array of values)
 * @returns Promise<QueryResult>
 */
async function query(queryStr, values) {
    const db = await getPool();
    return db.query(queryStr, values);
}
/**
 * Execute a query and return a single row or null.
 *
 * @param queryStr - SQL query string
 * @param values - Query parameters
 * @returns Promise<T | null>
 */
async function queryOne(queryStr, values) {
    const result = await query(queryStr, values);
    return result.rows[0] ?? null;
}
/**
 * Execute a query and return all rows.
 *
 * @param queryStr - SQL query string
 * @param values - Query parameters
 * @returns Promise<T[]>
 */
async function queryMany(queryStr, values) {
    const result = await query(queryStr, values);
    return result.rows;
}
