import http from 'http';
import { URL } from 'url';
import open from 'open';

const CLIENT_ID = '174034835014-ji5819evncjfsutg68qoqdrbi82vq8tn.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/drive',  // Full Drive access to list & manage files
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/userinfo.email',
];

export async function getAuthorizationUrl(): Promise<string> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
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
  expires_in: number;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  return response.json();
}

// Interactive auth flow - opens browser and waits for callback
export function startAuthFlow(): Promise<{ access_token: string; refresh_token: string }> {
  return new Promise(async (resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:3333`);

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
            const tokens = await exchangeCodeForTokens(code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<h1>Success!</h1><p>Google account connected. You can close this window.</p>`);
            server.close();
            resolve({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
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

    server.listen(3333, async () => {
      const authUrl = await getAuthorizationUrl();
      console.log('Opening browser for Google authorization...');
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

// Get user info to identify which account was connected
export async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  return data.email;
}
