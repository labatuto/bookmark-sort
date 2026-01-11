import { refreshAccessToken } from '../google-auth.js';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// Get a valid access token (refresh if needed)
async function getAccessToken(config: { access_token: string; refresh_token: string }): Promise<string> {
  // For now, try the existing token; if it fails, refresh
  // In production, we'd check expiry
  try {
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${config.access_token}` },
    });
    if (response.ok) return config.access_token;
  } catch {}

  // Refresh the token
  const newTokens = await refreshAccessToken(config.refresh_token);
  return newTokens.access_token;
}

// List files in a folder
export async function listFilesInFolder(
  folderId: string,
  config: { access_token: string; refresh_token: string }
): Promise<DriveFile[]> {
  const accessToken = await getAccessToken(config);

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: '100',
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to list files: ${await response.text()}`);
  }

  const data = await response.json();
  return data.files || [];
}

// Upload a PDF to a folder
export async function uploadPdfToFolder(
  folderId: string,
  fileName: string,
  pdfBuffer: Buffer,
  config: { access_token: string; refresh_token: string }
): Promise<string> {
  const accessToken = await getAccessToken(config);

  // Create multipart upload
  const boundary = '-------314159265358979323846';
  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    ),
    pdfBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to upload: ${await response.text()}`);
  }

  const data = await response.json();
  return data.id;
}

// Append content to a Google Doc
export async function appendToGoogleDoc(
  docId: string,
  content: {
    tweetUrl: string;
    authorHandle: string;
    text: string;
    date: string;
    mediaUrls?: string[];
  },
  config: { access_token: string; refresh_token: string }
): Promise<void> {
  const accessToken = await getAccessToken(config);

  // Get document to find end index
  const docResponse = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!docResponse.ok) {
    throw new Error(`Failed to get doc: ${await docResponse.text()}`);
  }

  const doc = await docResponse.json();
  const endIndex = doc.body.content[doc.body.content.length - 1].endIndex - 1;

  // Build the text to insert
  const insertText = `

---
@${content.authorHandle} · ${content.date}
${content.text}

Tweet: ${content.tweetUrl}
`;

  // Build requests array
  const requests: any[] = [
    {
      insertText: {
        location: { index: endIndex },
        text: insertText,
      },
    },
  ];

  // Add images after text if we have media URLs
  // Images are inserted after text, so we calculate their position
  if (content.mediaUrls && content.mediaUrls.length > 0) {
    // Insert a newline after the tweet link for images
    const imageInsertIndex = endIndex + insertText.length;

    // Insert images (reverse order since each insert shifts content)
    for (let i = content.mediaUrls.length - 1; i >= 0; i--) {
      const mediaUrl = content.mediaUrls[i];
      // Only insert images (skip videos/gifs for now as Docs doesn't support them inline)
      if (mediaUrl.match(/\.(jpg|jpeg|png|gif|webp)/i) || mediaUrl.includes('pbs.twimg.com')) {
        requests.push({
          insertInlineImage: {
            location: { index: imageInsertIndex },
            uri: mediaUrl,
            objectSize: {
              width: { magnitude: 400, unit: 'PT' },
              height: { magnitude: 300, unit: 'PT' },
            },
          },
        });
        // Add newline after image
        requests.push({
          insertText: {
            location: { index: imageInsertIndex },
            text: '\n',
          },
        });
      }
    }
  }

  // Insert text at end of document
  const updateResponse = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  );

  if (!updateResponse.ok) {
    throw new Error(`Failed to update doc: ${await updateResponse.text()}`);
  }
}

// Extract folder ID from Google Drive URL
export function extractFolderId(url: string): string | null {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Extract doc ID from Google Docs URL
export function extractDocId(url: string): string | null {
  const match = url.match(/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Create a new Google Doc
export async function createGoogleDoc(
  title: string,
  folderId: string | null,
  config: { access_token: string; refresh_token: string }
): Promise<{ id: string; name: string }> {
  const accessToken = await getAccessToken(config);

  const metadata: any = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    throw new Error(`Failed to create doc: ${await response.text()}`);
  }

  const data = await response.json();
  return { id: data.id, name: data.name };
}

// Search for Google Docs across all of Drive
export async function searchDocs(
  query: string,
  config: { access_token: string; refresh_token: string }
): Promise<DriveFile[]> {
  const accessToken = await getAccessToken(config);

  // Search for docs matching the query
  const params = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.document' and name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: '20',
    orderBy: 'modifiedTime desc',
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to search docs: ${await response.text()}`);
  }

  const data = await response.json();
  return data.files || [];
}
