import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthResult {
  userId: string;
  workspaceId: string;
}

/**
 * Validates JWT authentication and workspace access.
 * Supports both user JWT tokens and service-to-service calls.
 * 
 * For service-to-service calls (from other edge functions), the calling function
 * should pass the service role key in the Authorization header.
 */
export async function validateAuth(
  req: Request,
  requestedWorkspaceId?: string
): Promise<AuthResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  const token = authHeader.replace('Bearer ', '');

  // Allow service-to-service calls using the service role key
  if (token === supabaseServiceKey) {
    if (!requestedWorkspaceId) {
      throw new AuthError('workspace_id is required for service calls', 400);
    }
    return { userId: 'service_role', workspaceId: requestedWorkspaceId };
  }

  // Validate user JWT
  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data, error } = await userSupabase.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError('Invalid or expired authentication token', 401);
  }

  const userId = data.user.id;

  // Get user's workspace
  const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: userData, error: userError } = await serviceSupabase
    .from('users')
    .select('workspace_id')
    .eq('id', userId)
    .single();

  if (userError || !userData?.workspace_id) {
    throw new AuthError('User not found or not assigned to a workspace', 403);
  }

  // If a specific workspace was requested, verify access
  if (requestedWorkspaceId && userData.workspace_id !== requestedWorkspaceId) {
    throw new AuthError('Access denied: workspace mismatch', 403);
  }

  return { userId, workspaceId: userData.workspace_id };
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function authErrorResponse(error: AuthError): Response {
  return new Response(
    JSON.stringify({ error: error.message }),
    { 
      status: error.statusCode, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}
