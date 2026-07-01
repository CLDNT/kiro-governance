/**
 * Authentication context extracted from API Gateway authorizer claims.
 * Populated by withAuth middleware from Cognito JWT claims.
 */
export interface AuthContext {
    /** Cognito subject (user unique identifier) */
    userId: string;
    /** User email address from cognito:email claim */
    email: string;
    /** User name from name claim */
    name: string;
    /** Role derived from cognito:groups (first group mapped to enum) */
    role: 'admin' | 'leadership' | 'pm' | 'sa' | 'engineer';
    /** All groups the user belongs to (from cognito:groups claim) */
    groups: string[];
}
