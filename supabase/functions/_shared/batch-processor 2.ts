// =============================================================================
// BATCH PROCESSING UTILITIES
// Shared utilities for processing large volumes with rate limiting & checkpointing
// =============================================================================

export interface BatchConfig {
  batchSize: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutBufferMs: number; // Stop processing before edge function timeout
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  batchSize: 50,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutBufferMs: 50000, // Stop 10s before 60s timeout
};

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function getBackoffDelay(attempt: number, config: BatchConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // Add 0-1s jitter
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Check if we should continue processing based on elapsed time
 */
export function shouldContinueProcessing(startTime: number, config: BatchConfig): boolean {
  const elapsed = Date.now() - startTime;
  return elapsed < config.timeoutBufferMs;
}

/**
 * Parse rate limit retry-after header or error message
 */
export function parseRetryAfter(response: Response, errorText: string): number | null {
  // Check Retry-After header
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }

  // Parse from error message (e.g., "Please retry in 38.692768089s")
  const match = errorText.match(/retry in ([\d.]+)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000);
  }

  return null;
}

/**
 * Wrapper for API calls with exponential backoff and rate limit handling
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: BatchConfig = DEFAULT_BATCH_CONFIG,
  onRetry?: (attempt: number, delay: number, error: Error) => void
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if rate limited
      const isRateLimited = error.message?.includes('429') || 
                           error.message?.includes('rate limit') ||
                           error.message?.includes('quota');
      
      if (!isRateLimited && attempt === config.maxRetries - 1) {
        throw error;
      }

      const delay = getBackoffDelay(attempt, config);
      
      if (onRetry) {
        onRetry(attempt + 1, delay, error);
      }
      
      console.log(`[withRetry] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Process items in batches with progress tracking
 */
export async function processBatches<T, R>(
  items: T[],
  processor: (batch: T[], batchIndex: number) => Promise<R[]>,
  config: BatchConfig = DEFAULT_BATCH_CONFIG,
  onProgress?: (processed: number, total: number) => Promise<void>
): Promise<{ results: R[]; processed: number; interrupted: boolean }> {
  const startTime = Date.now();
  const results: R[] = [];
  let processed = 0;

  for (let i = 0; i < items.length; i += config.batchSize) {
    // Check if we should stop before timeout
    if (!shouldContinueProcessing(startTime, config)) {
      console.log(`[processBatches] Stopping early to avoid timeout. Processed ${processed}/${items.length}`);
      return { results, processed, interrupted: true };
    }

    const batch = items.slice(i, i + config.batchSize);
    const batchIndex = Math.floor(i / config.batchSize);

    try {
      const batchResults = await withRetry(
        () => processor(batch, batchIndex),
        config,
        (attempt, delay) => {
          console.log(`[processBatches] Batch ${batchIndex} retry ${attempt}, waiting ${delay}ms`);
        }
      );

      results.push(...batchResults);
      processed += batch.length;

      if (onProgress) {
        await onProgress(processed, items.length);
      }
    } catch (error) {
      console.error(`[processBatches] Batch ${batchIndex} failed after retries:`, error);
      // Return partial results
      return { results, processed, interrupted: true };
    }
  }

  return { results, processed, interrupted: false };
}

/**
 * Chain edge function calls for continuation
 */
export async function chainNextBatch(
  supabaseUrl: string,
  functionName: string,
  payload: Record<string, unknown>,
  serviceRoleKey: string
): Promise<void> {
  try {
    // Fire and forget - don't await
    fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch(err => {
      console.error(`[chainNextBatch] Failed to trigger ${functionName}:`, err);
    });
  } catch (error) {
    console.error(`[chainNextBatch] Error:`, error);
  }
}
