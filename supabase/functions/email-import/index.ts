import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// CONFIGURATION
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AURINKO_API_BASE = 'https://api.aurinko.io/v1';
const BATCH_SIZE = 50; // Aurinko's max per request
const FUNCTION_NAME = 'email-import';

// Import mode limits
const IMPORT_LIMITS: Record<string, number> = {
  'last_100': 100,
  'last_1000': 1000,
};

// =============================================================================
// TYPES
// =============================================================================

interface ImportRequest {
  workspace_id: string;
  import_mode: 'last_100' | 'last_1000';
}

interface AurinkoMessage {
  id: string;
  threadId?: string;
  from?: { address?: string; name?: string };
  to?: Array<{ address?: string; name?: string }>;
  subject?: string;
  textBody?: string;
  bodySnippet?: string;
  receivedAt?: string;
  createdAt?: string;
}

interface AurinkoResponse {
  records?: AurinkoMessage[];
  nextPageToken?: string;
}

interface ImportResult {
  success: boolean;
  total_imported: number;
  sent_count: number;
  inbox_count: number;
  duration_ms: number;
  workspace_id: string;
}

interface ImportError {
  success: false;
  error: string;
  function: string;
  step: string;
  duration_ms: number;
  context?: Record<string, unknown>;
}

interface FolderImportResult {
  count: number;
  fetched: number;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let currentStep = 'initializing';
  let workspaceId: string | undefined;

  try {
    // -------------------------------------------------------------------------
    // STEP 0: Authenticate caller
    // -------------------------------------------------------------------------
    currentStep = 'authenticating';

    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let bodyRaw: any;
    try {
      bodyRaw = await req.clone().json();
    } catch { bodyRaw = {}; }
    try {
      await validateAuth(req, bodyRaw.workspace_id);
    } catch (authErr: any) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    // -------------------------------------------------------------------------
    // STEP 1: Validate environment
    // -------------------------------------------------------------------------
    currentStep = 'validating_environment';
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL environment variable is not configured');
    }
    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -------------------------------------------------------------------------
    // STEP 2: Parse and validate input
    // -------------------------------------------------------------------------
    currentStep = 'parsing_input';
    
    let body: Partial<ImportRequest>;
    try {
      body = await req.json();
    } catch {
      throw new Error('Invalid JSON in request body');
    }

    // Validate workspace_id
    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }
    if (typeof body.workspace_id !== 'string') {
      throw new Error('workspace_id must be a string');
    }
    workspaceId = body.workspace_id;

    // Validate import_mode
    if (!body.import_mode) {
      throw new Error('import_mode is required');
    }
    if (!Object.keys(IMPORT_LIMITS).includes(body.import_mode)) {
      throw new Error(`import_mode must be one of: ${Object.keys(IMPORT_LIMITS).join(', ')}`);
    }

    const importMode = body.import_mode as keyof typeof IMPORT_LIMITS;
    const maxEmails = IMPORT_LIMITS[importMode];

    console.log(`[${FUNCTION_NAME}] Starting import:`, {
      workspace_id: workspaceId,
      import_mode: importMode,
      max_emails: maxEmails,
    });

    // -------------------------------------------------------------------------
    // STEP 3: Get email provider configuration
    // -------------------------------------------------------------------------
    currentStep = 'fetching_email_config';

    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, email_address, provider')
      .eq('workspace_id', workspaceId)
      .single();

    if (configError) {
      if (configError.code === 'PGRST116') {
        throw new Error('Email not connected. Please connect your email account first.');
      }
      throw new Error(`Failed to fetch email config: ${configError.message}`);
    }

    if (!emailConfig) {
      throw new Error('Email not connected. Please connect your email account first.');
    }

    // Get decrypted access token securely
    const { data: accessToken, error: tokenError } = await supabase
      .rpc('get_decrypted_access_token', { config_id: emailConfig.id });

    if (tokenError || !accessToken) {
      throw new Error('Email access token is missing. Please reconnect your email account.');
    }

    console.log(`[${FUNCTION_NAME}] Found email config for: ${emailConfig.email_address}`);

    // -------------------------------------------------------------------------
    // STEP 4: Initialize import progress
    // -------------------------------------------------------------------------
    currentStep = 'initializing_progress';

    const { error: progressInitError } = await supabase
      .from('import_progress')
      .upsert({
        workspace_id: workspaceId,
        status: 'in_progress',
        total_emails: 0,
        processed_emails: 0,
        current_step: 'Starting import...',
        error: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      }, { 
        onConflict: 'workspace_id' 
      });

    if (progressInitError) {
      console.error(`[${FUNCTION_NAME}] Warning: Failed to initialize progress:`, progressInitError);
      // Continue anyway - progress tracking is nice-to-have, not critical
    }

    // -------------------------------------------------------------------------
    // STEP 5: Import SENT emails
    // -------------------------------------------------------------------------
    currentStep = 'importing_sent_emails';
    const sentLimit = Math.floor(maxEmails / 2);

    await updateProgress(supabase, workspaceId, 'Importing sent emails...');

    const sentResult = await importEmailsFromFolder({
      supabase,
      accessToken: accessToken,
      workspaceId,
      folder: 'SENT',
      limit: sentLimit,
    });

    console.log(`[${FUNCTION_NAME}] Sent emails imported: ${sentResult.count}`, {
      fetched: sentResult.fetched,
      saved: sentResult.count,
      skipped_duplicates: sentResult.fetched - sentResult.count,
    });

    // -------------------------------------------------------------------------
    // STEP 6: Import INBOX emails
    // -------------------------------------------------------------------------
    currentStep = 'importing_inbox_emails';
    const inboxLimit = Math.floor(maxEmails / 2);

    await updateProgress(supabase, workspaceId, 'Importing inbox emails...');

    const inboxResult = await importEmailsFromFolder({
      supabase,
      accessToken: accessToken,
      workspaceId,
      folder: 'INBOX',
      limit: inboxLimit,
    });

    console.log(`[${FUNCTION_NAME}] Inbox emails imported: ${inboxResult.count}`, {
      fetched: inboxResult.fetched,
      saved: inboxResult.count,
      skipped_duplicates: inboxResult.fetched - inboxResult.count,
    });

    // -------------------------------------------------------------------------
    // STEP 7: Finalize and return results
    // -------------------------------------------------------------------------
    currentStep = 'finalizing';

    const totalImported = sentResult.count + inboxResult.count;
    const duration = Date.now() - startTime;

    // Update progress to completed
    const { error: progressCompleteError } = await supabase
      .from('import_progress')
      .update({
        status: 'completed',
        total_emails: totalImported,
        processed_emails: totalImported,
        current_step: 'Import complete!',
        completed_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    if (progressCompleteError) {
      console.error(`[${FUNCTION_NAME}] Warning: Failed to update completion status:`, progressCompleteError);
    }

    const result: ImportResult = {
      success: true,
      total_imported: totalImported,
      sent_count: sentResult.count,
      inbox_count: inboxResult.count,
      duration_ms: duration,
      workspace_id: workspaceId,
    };

    console.log(`[${FUNCTION_NAME}] Completed successfully in ${duration}ms:`, result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    console.error(`[${FUNCTION_NAME}] Error at step "${currentStep}":`, {
      error: errorMessage,
      workspace_id: workspaceId,
      duration_ms: duration,
    });

    // Attempt to update progress with error status
    if (workspaceId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        
        await supabase
          .from('import_progress')
          .update({
            status: 'error',
            current_step: `Error: ${errorMessage}`,
            error: errorMessage,
          })
          .eq('workspace_id', workspaceId);
      } catch (progressError) {
        console.error(`[${FUNCTION_NAME}] Failed to update error status:`, progressError);
      }
    }

    const errorResponse: ImportError = {
      success: false,
      error: errorMessage,
      function: FUNCTION_NAME,
      step: currentStep,
      duration_ms: duration,
      context: workspaceId ? { workspace_id: workspaceId } : undefined,
    };

    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Updates the import progress step for UI polling.
 * Failures are logged but don't stop execution - progress tracking is non-critical.
 */
async function updateProgress(
  supabase: SupabaseClient,
  workspaceId: string,
  step: string
): Promise<void> {
  const { error } = await supabase
    .from('import_progress')
    .update({ current_step: step })
    .eq('workspace_id', workspaceId);

  if (error) {
    console.warn(`[${FUNCTION_NAME}] Failed to update progress step:`, error.message);
  }
}

/**
 * Updates the import progress with current email count.
 * Called after each batch to show progress in the UI.
 */
async function updateProgressCount(
  supabase: SupabaseClient,
  workspaceId: string,
  count: number,
  folder: string
): Promise<void> {
  const { error } = await supabase
    .from('import_progress')
    .update({
      processed_emails: count,
      current_step: `Imported ${count} ${folder.toLowerCase()} emails...`,
    })
    .eq('workspace_id', workspaceId);

  if (error) {
    console.warn(`[${FUNCTION_NAME}] Failed to update progress count:`, error.message);
  }
}

/**
 * Imports emails from a specific folder (SENT or INBOX).
 * 
 * Uses pagination to fetch all emails up to the limit.
 * Handles Aurinko API errors with specific error messages.
 * Uses upsert to handle duplicate emails gracefully.
 * 
 * @returns count of emails saved and total fetched
 */
async function importEmailsFromFolder(params: {
  supabase: SupabaseClient;
  accessToken: string;
  workspaceId: string;
  folder: 'SENT' | 'INBOX';
  limit: number;
}): Promise<FolderImportResult> {
  const { supabase, accessToken, workspaceId, folder, limit } = params;
  
  let totalFetched = 0;
  let totalSaved = 0;
  let nextPageToken: string | undefined;

  while (totalFetched < limit) {
    // Calculate how many to fetch this batch
    const batchLimit = Math.min(BATCH_SIZE, limit - totalFetched);

    // Build Aurinko API URL
    const url = new URL(`${AURINKO_API_BASE}/email/messages`);
    url.searchParams.set('limit', String(batchLimit));
    url.searchParams.set('folder', folder);
    if (nextPageToken) {
      url.searchParams.set('pageToken', nextPageToken);
    }

    // Fetch from Aurinko API
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Handle HTTP errors with specific messages
    if (!response.ok) {
      const errorBody = await response.text();
      
      if (response.status === 401) {
        throw new Error('Email access token expired. Please reconnect your email account.');
      }
      if (response.status === 403) {
        throw new Error('Email access denied. Please check your email permissions and reconnect.');
      }
      if (response.status === 429) {
        throw new Error('Rate limited by email provider. Please try again in a few minutes.');
      }
      if (response.status >= 500) {
        throw new Error(`Email provider is temporarily unavailable. Please try again later. (${response.status})`);
      }
      
      throw new Error(`Aurinko API error (${folder}): ${response.status} - ${errorBody}`);
    }

    // Parse response
    let data: AurinkoResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Aurinko API returned invalid JSON for ${folder} folder`);
    }

    // Validate response structure
    if (!data || typeof data !== 'object') {
      throw new Error(`Aurinko API returned unexpected format for ${folder} folder`);
    }

    const messages = data.records || [];
    
    // If no messages returned, we've reached the end
    if (messages.length === 0) {
      console.log(`[${FUNCTION_NAME}] No more ${folder} emails to fetch`);
      break;
    }

    // Transform messages for database
    const emailsToSave = messages.map((msg) => transformAurinkoMessage(msg, workspaceId, folder));

    // Save to database using upsert
    // onConflict handles duplicates gracefully - if an email with the same
    // workspace_id + external_id exists, it will be updated instead of inserted
    const { error: insertError, data: insertedData } = await supabase
      .from('raw_emails')
      .upsert(emailsToSave, { 
        onConflict: 'workspace_id,external_id',
        ignoreDuplicates: true,
      })
      .select('id');

    if (insertError) {
      // Log but don't fail - partial success is better than total failure
      console.error(`[${FUNCTION_NAME}] Error saving ${folder} emails:`, insertError.message);
      // Continue with count of 0 for this batch
    }

    const savedCount = insertedData?.length || 0;
    totalFetched += messages.length;
    totalSaved += savedCount;

    // Update progress for UI
    await updateProgressCount(supabase, workspaceId, totalSaved, folder);

    console.log(`[${FUNCTION_NAME}] ${folder} batch: fetched=${messages.length}, saved=${savedCount}, total=${totalFetched}`);

    // Check for next page
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) {
      console.log(`[${FUNCTION_NAME}] Reached end of ${folder} emails`);
      break;
    }
  }

  return { count: totalSaved, fetched: totalFetched };
}

/**
 * Transforms an Aurinko message to our raw_emails schema.
 * 
 * Handles missing fields gracefully with sensible defaults.
 * Normalizes data format for consistent storage.
 */
function transformAurinkoMessage(
  msg: AurinkoMessage,
  workspaceId: string,
  folder: string
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    external_id: msg.id,
    thread_id: msg.threadId || null,
    folder: folder,
    from_email: msg.from?.address || '',
    from_name: msg.from?.name || '',
    to_email: msg.to?.[0]?.address || '',
    subject: msg.subject || '(No subject)',
    body_text: msg.textBody || msg.bodySnippet || '',
    received_at: msg.receivedAt || msg.createdAt || new Date().toISOString(),
    processed: false,
    classification: null,
    created_at: new Date().toISOString(),
  };
}
