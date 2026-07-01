import { Pool } from 'pg';
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
export declare function getPool(): Promise<Pool>;
/**
 * Close the database pool gracefully.
 * Call this during Lambda shutdown or in test cleanup.
 */
export declare function closePool(): Promise<void>;
/**
 * Execute a query with automatic connection pooling and token refresh.
 *
 * @param queryStr - SQL query string (use $1, $2, etc. for parameters)
 * @param values - Query parameters (array of values)
 * @returns Promise<QueryResult>
 */
export declare function query(queryStr: string, values?: unknown[]): Promise<import("pg").QueryResult<any>>;
/**
 * Execute a query and return a single row or null.
 *
 * @param queryStr - SQL query string
 * @param values - Query parameters
 * @returns Promise<T | null>
 */
export declare function queryOne<T = Record<string, unknown>>(queryStr: string, values?: unknown[]): Promise<T | null>;
/**
 * Execute a query and return all rows.
 *
 * @param queryStr - SQL query string
 * @param values - Query parameters
 * @returns Promise<T[]>
 */
export declare function queryMany<T = Record<string, unknown>>(queryStr: string, values?: unknown[]): Promise<T[]>;
