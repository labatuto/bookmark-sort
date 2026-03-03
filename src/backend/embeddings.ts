import OpenAI from 'openai';
import { getBookmarksWithoutEmbeddings, updateBookmarkEmbedding } from './db.js';

let openai: OpenAI | null = null;

export function initOpenAI(apiKey: string) {
  openai = new OpenAI({ apiKey });
}

// Generate embedding for a single text
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!openai) {
    throw new Error('OpenAI not initialized. Call initOpenAI first.');
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0].embedding;
}

// Generate embeddings for multiple texts (batched)
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!openai) {
    throw new Error('OpenAI not initialized. Call initOpenAI first.');
  }

  // OpenAI batch limit is 2048 inputs
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });

    for (const item of response.data) {
      results.push(item.embedding);
    }
  }

  return results;
}

// Process all bookmarks without embeddings
export async function embedUnprocessedBookmarks(
  onProgress?: (processed: number, total: number) => void
): Promise<{ processed: number; errors: number }> {
  const bookmarks = await getBookmarksWithoutEmbeddings();
  let processed = 0;
  let errors = 0;

  // Process in batches
  const BATCH_SIZE = 50;

  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(b => `@${b.author_handle}: ${b.text}`);

    try {
      const embeddings = await generateEmbeddings(texts);

      for (let j = 0; j < batch.length; j++) {
        try {
          await updateBookmarkEmbedding(batch[j].id, embeddings[j]);
          processed++;
        } catch (err) {
          console.error(`Error saving embedding for ${batch[j].id}:`, err);
          errors++;
        }
      }
    } catch (err) {
      console.error(`Error generating embeddings for batch:`, err);
      errors += batch.length;
    }

    if (onProgress) {
      onProgress(processed + errors, bookmarks.length);
    }
  }

  return { processed, errors };
}

// Cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Search bookmarks by semantic similarity
export async function searchBookmarks(
  query: string,
  allBookmarks: Array<{ id: string; embedding?: number[]; [key: string]: any }>,
  topK: number = 50
): Promise<Array<{ id: string; similarity: number; [key: string]: any }>> {
  const queryEmbedding = await generateEmbedding(query);

  const results = allBookmarks
    .filter(b => b.embedding && b.embedding.length > 0)
    .map(bookmark => ({
      ...bookmark,
      similarity: cosineSimilarity(queryEmbedding, bookmark.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return results;
}

// Find similar bookmarks by bookmark ID (uses existing embedding)
export function findSimilarBookmarks(
  bookmarkId: string,
  allBookmarks: Array<{ id: string; embedding?: number[]; [key: string]: any }>,
  topK: number = 10
): Array<{ id: string; similarity: number; [key: string]: any }> {
  const targetBookmark = allBookmarks.find(b => b.id === bookmarkId);
  if (!targetBookmark || !targetBookmark.embedding || targetBookmark.embedding.length === 0) {
    return [];
  }

  const results = allBookmarks
    .filter(b => b.id !== bookmarkId && b.embedding && b.embedding.length > 0)
    .map(bookmark => ({
      ...bookmark,
      similarity: cosineSimilarity(targetBookmark.embedding!, bookmark.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return results;
}
