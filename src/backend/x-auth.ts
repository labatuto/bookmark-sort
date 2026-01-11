import http from 'http';
import { URL } from 'url';
import open from 'open';
import crypto from 'crypto';

// X OAuth 2.0 with PKCE
// Client credentials should be set via environment variables
const CLIENT_ID = process.env.X_CLIENT_ID || '';
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3334/callback';

// Scopes needed for unbookmarking
const SCOPES = [
  'tweet.read',
  'users.read',
  'bookmark.read',
  'bookmark.write', // Required to delete bookmarks
  'offline.access',  // For refresh tokens
];

// PKCE helper functions
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function getAuthorizationUrl(codeVerifier: string): string {
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  return response.json();
}

// Get authenticated user's ID (needed for unbookmark endpoint)
export async function getAuthenticatedUserId(accessToken: string): Promise<string> {
  const response = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user: ${await response.text()}`);
  }

  const data = await response.json();
  return data.data.id;
}

// Get username for display
export async function getAuthenticatedUser(accessToken: string): Promise<{ id: string; username: string }> {
  const response = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    id: data.data.id,
    username: data.data.username,
  };
}

// Interactive auth flow - opens browser and waits for callback
export function startAuthFlow(): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  username: string;
}> {
  return new Promise(async (resolve, reject) => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      reject(new Error('X_CLIENT_ID and X_CLIENT_SECRET environment variables must be set'));
      return;
    }

    const codeVerifier = generateCodeVerifier();

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:3334`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error: ${error}</h1><p>You can close this window.</p>`);
          server.close();
          reject(new Error(error));
          return;
        }

        if (code) {
          try {
            const tokens = await exchangeCodeForTokens(code, codeVerifier);
            const user = await getAuthenticatedUser(tokens.access_token);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<h1>Success!</h1><p>X account @${user.username} connected. You can close this window.</p>`);
            server.close();
            resolve({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              user_id: user.id,
              username: user.username,
            });
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h1>Error exchanging code</h1><p>${err}</p>`);
            server.close();
            reject(err);
          }
        }
      }
    });

    server.listen(3334, async () => {
      const authUrl = getAuthorizationUrl(codeVerifier);
      console.log('Opening browser for X authorization...');
      console.log('If browser does not open, visit:', authUrl);
      await open(authUrl);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out'));
    }, 300000);
  });
}

export function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}
