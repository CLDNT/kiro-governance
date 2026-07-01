import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoRefreshToken,
  IAuthenticationCallback,
} from 'amazon-cognito-identity-js';
import { jwtDecode } from 'jwt-decode';

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
});

interface DecodedIdToken {
  sub: string;
  email: string;
  name: string;
  'cognito:groups'?: string[];
  exp: number;
  iat: number;
}

interface CurrentUser {
  userId: string;
  email: string;
  name: string;
  role: 'pm' | 'sa' | 'engineer' | 'leadership' | 'admin';
  groups: string[];
}

// Holds the CognitoUser object when new password is required
// so completeNewPassword() can reference it
let pendingNewPasswordUser: CognitoUser | null = null;
// Holds the user attributes returned by newPasswordRequired (minus read-only fields)
let pendingUserAttributes: Record<string, string> = {};

let accessToken: string | null = null;
let idToken: string | null = null;
let refreshToken: string | null = null;

const ROLE_PRIORITY = ['admin', 'leadership', 'pm', 'sa', 'engineer'] as const;

function resolveRole(groups: string[]): CurrentUser['role'] {
  for (const role of ROLE_PRIORITY) {
    if (groups.includes(role)) return role;
  }
  return 'engineer';
}

function storeSession(result: { getAccessToken(): { getJwtToken(): string }; getIdToken(): { getJwtToken(): string }; getRefreshToken(): { getToken(): string } }): CurrentUser {
  accessToken = result.getAccessToken().getJwtToken();
  idToken = result.getIdToken().getJwtToken();
  refreshToken = result.getRefreshToken().getToken();
  if (refreshToken) sessionStorage.setItem('refresh_token', refreshToken);
  const user = getCurrentUser();
  if (!user) throw new Error('Failed to decode user from token');
  return user;
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  return new Promise((resolve, reject) => {
    const existingUser = userPool.getCurrentUser();
    if (existingUser) existingUser.signOut();

    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    const callbacks: IAuthenticationCallback = {
      onSuccess: (result) => {
        pendingNewPasswordUser = null;
        resolve(storeSession(result));
      },
      onFailure: (err) => {
        reject(new Error(err.message || 'Authentication failed'));
      },
      newPasswordRequired: (userAttributes, _requiredAttributes) => {
        // Strip ALL read-only / system attributes Cognito won't accept back
        const readOnly = new Set([
          'sub', 'email_verified', 'phone_number_verified',
          'email', 'phone_number', 'cognito:user_status',
          'cognito:email_alias', 'cognito:phone_number_alias',
        ]);

        const editableAttributes: Record<string, string> = {};
        for (const [key, value] of Object.entries(userAttributes as Record<string, string>)) {
          if (!readOnly.has(key) && !key.startsWith('cognito:')) {
            editableAttributes[key] = value as string;
          }
        }

        // Cognito requires 'name' — fall back to email if not set
        if (!editableAttributes.name) {
          editableAttributes.name = email;
        }

        pendingNewPasswordUser = cognitoUser;
        pendingUserAttributes = editableAttributes;
        reject(new Error('NEW_PASSWORD_REQUIRED'));
      },
    };

    cognitoUser.authenticateUser(authDetails, callbacks);
  });
}

/**
 * Complete the new-password-required challenge.
 * Call this after login() throws NEW_PASSWORD_REQUIRED.
 */
export async function completeNewPassword(newPassword: string): Promise<CurrentUser> {
  return new Promise((resolve, reject) => {
    if (!pendingNewPasswordUser) {
      reject(new Error('No pending new-password challenge. Please log in again.'));
      return;
    }

    pendingNewPasswordUser.completeNewPasswordChallenge(newPassword, pendingUserAttributes, {
      onSuccess: (result) => {
        pendingNewPasswordUser = null;
        pendingUserAttributes = {};
        resolve(storeSession(result));
      },
      onFailure: (err) => {
        reject(new Error(err.message || 'Failed to set new password'));
      },
    });
  });
}

export function logout(): void {
  accessToken = null;
  idToken = null;
  refreshToken = null;
  pendingNewPasswordUser = null;
  pendingUserAttributes = {};
  sessionStorage.removeItem('refresh_token');
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) cognitoUser.signOut();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getIdToken(): string | null {
  return idToken;
}

/**
 * Restore session from Cognito's localStorage on page reload.
 * Cognito SDK stores tokens under CognitoIdentityServiceProvider.{clientId}.{username}.*
 * Returns the current user if a valid session exists, null otherwise.
 */
export function restoreSession(): CurrentUser | null {
  try {
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string;
    const lastUserKey = `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`;
    const username = localStorage.getItem(lastUserKey);
    if (!username) return null;

    const prefix = `CognitoIdentityServiceProvider.${clientId}.${username}`;
    const storedIdToken = localStorage.getItem(`${prefix}.idToken`);
    const storedAccessToken = localStorage.getItem(`${prefix}.accessToken`);
    const storedRefreshToken = localStorage.getItem(`${prefix}.refreshToken`);

    if (!storedIdToken || !storedAccessToken) return null;

    // Decode and check expiry before restoring
    const decoded = jwtDecode<DecodedIdToken>(storedIdToken);
    if (decoded.exp * 1000 < Date.now()) {
      // Access token expired — restore refresh token so AuthContext can do silent refresh
      refreshToken = storedRefreshToken;
      if (storedRefreshToken) sessionStorage.setItem('refresh_token', storedRefreshToken);
      return null;
    }

    // Tokens valid — restore all in-memory state
    idToken = storedIdToken;
    accessToken = storedAccessToken;
    refreshToken = storedRefreshToken;
    if (storedRefreshToken) sessionStorage.setItem('refresh_token', storedRefreshToken);

    // Build user directly from decoded token (no second decode needed)
    const groups = decoded['cognito:groups'] || [];
    return {
      userId: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.email,
      role: resolveRole(groups),
      groups,
    };
  } catch {
    return null;
  }
}

export function getCurrentUser(): CurrentUser | null {
  if (!idToken) return null;
  try {
    const decoded = jwtDecode<DecodedIdToken>(idToken);
    const groups = decoded['cognito:groups'] || [];
    return {
      userId: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.email,
      role: resolveRole(groups),
      groups,
    };
  } catch {
    return null;
  }
}

export async function refreshTokens(): Promise<boolean> {
  if (!refreshToken) refreshToken = sessionStorage.getItem('refresh_token');
  if (!refreshToken) return false;

  return new Promise((resolve) => {
    // Restore the Cognito user from the last-auth-user localStorage key
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string;
    const username = localStorage.getItem(
      `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`
    );

    // Use userPool.getCurrentUser() which reads from localStorage internally
    const cognitoUser = username
      ? new CognitoUser({ Username: username, Pool: userPool })
      : userPool.getCurrentUser();

    if (!cognitoUser) { resolve(false); return; }

    const token = new CognitoRefreshToken({ RefreshToken: refreshToken as string });
    cognitoUser.refreshSession(token, (err, session) => {
      if (err) { resolve(false); return; }
      accessToken = session.getAccessToken().getJwtToken();
      idToken = session.getIdToken().getJwtToken();
      refreshToken = session.getRefreshToken().getToken();
      if (refreshToken) sessionStorage.setItem('refresh_token', refreshToken);
      resolve(true);
    });
  });
}
