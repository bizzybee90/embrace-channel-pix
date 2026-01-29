import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface ApifyCustomer {
  customer_id: string;
  customer_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  next_appointment?: string;
  price?: number;
  frequency?: string;
  schedule_code?: string;
  notes?: string;
  status?: string;
  payment_method?: string;
  balance?: number;
  tier?: string;
}

interface ApifyPayload {
  workspace_id?: string;
  customers?: ApifyCustomer[];
  [key: string]: unknown;
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Timing-safe comparison
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// Verify HMAC signature from Apify webhook
async function verifyHmacSignature(payload: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(payload);
    
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBytes = await crypto.subtle.sign('HMAC', key, messageData);
    const expectedSignature = bytesToHex(new Uint8Array(signatureBytes));
    
    const sigBytes = hexToBytes(signature.toLowerCase());
    const expectedBytes = hexToBytes(expectedSignature);
    
    return timingSafeEqual(sigBytes, expectedBytes);
  } catch {
    return false;
  }
}

// Verify shared secret header
function verifySharedSecret(headerSecret: string | null, envSecret: string): boolean {
  if (!headerSecret || !envSecret) return false;
  
  try {
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(headerSecret);
    const envBytes = encoder.encode(envSecret);
    
    return timingSafeEqual(headerBytes, envBytes);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  // No CORS for webhook endpoints - these are server-to-server calls
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const webhookSecret = Deno.env.get('APIFY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('APIFY_WEBHOOK_SECRET not configured');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Read raw body for signature verification
    const rawBody = await req.text();
    
    // Auth method 1: HMAC signature (preferred)
    const hmacSignature = req.headers.get('x-apify-signature') || req.headers.get('x-signature');
    
    // Auth method 2: Shared secret header
    const sharedSecretHeader = req.headers.get('x-webhook-secret') || req.headers.get('authorization')?.replace('Bearer ', '');
    
    const isHmacValid = await verifyHmacSignature(rawBody, hmacSignature, webhookSecret);
    const isSharedSecretValid = verifySharedSecret(sharedSecretHeader ?? null, webhookSecret);
    
    if (!isHmacValid && !isSharedSecretValid) {
      console.error('Authentication failed: Invalid or missing credentials');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let payload: ApifyPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Received authenticated Apify webhook');

    // CRITICAL: Workspace must be explicitly provided - no fallback to "first workspace"
    const workspaceId = payload.workspace_id || req.headers.get('x-workspace-id');
    
    if (!workspaceId) {
      console.error('No workspace_id provided in payload or headers');
      return new Response(JSON.stringify({ 
        error: 'Bad Request',
        message: 'workspace_id is required in payload or x-workspace-id header'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate workspace exists
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();

    if (workspaceError || !workspace) {
      console.error('Workspace not found:', workspaceId);
      return new Response(JSON.stringify({ 
        error: 'Bad Request',
        message: 'Invalid workspace_id'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Extract customers array from payload (handle both single and batch)
    const customers: ApifyCustomer[] = Array.isArray(payload) 
      ? payload 
      : payload.customers 
      ? payload.customers 
      : [payload as unknown as ApifyCustomer];

    // Payload size validation - prevent DoS attacks
    const MAX_CUSTOMERS_PER_REQUEST = 1000;
    if (customers.length > MAX_CUSTOMERS_PER_REQUEST) {
      console.warn(`Rejected oversized payload: ${customers.length} customers (max ${MAX_CUSTOMERS_PER_REQUEST})`);
      return new Response(JSON.stringify({ 
        error: 'Payload too large',
        message: `Maximum ${MAX_CUSTOMERS_PER_REQUEST} customers per request`
      }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (customers.length === 0 || !customers[0].customer_id) {
      return new Response(JSON.stringify({ 
        error: 'Bad Request',
        message: 'No valid customer data provided'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    // Process each customer using UPSERT to prevent duplicates
    for (const customer of customers) {
      try {
        if (!customer.customer_id) {
          errors.push('Missing customer_id');
          continue;
        }

        const customerData = {
          workspace_id: workspace.id,
          customer_id: customer.customer_id,
          name: customer.customer_name || null,
          address: customer.address || null,
          phone: customer.phone || null,
          email: customer.email || null,
          next_appointment: customer.next_appointment || null,
          price: customer.price || null,
          frequency: customer.frequency || null,
          schedule_code: customer.schedule_code || null,
          notes: customer.notes || null,
          status: customer.status || 'active',
          payment_method: customer.payment_method || null,
          balance: customer.balance || 0,
          tier: customer.tier || 'regular',
          last_updated: new Date().toISOString(),
        };

        // Use upsert with composite key (workspace_id + customer_id) to prevent duplicates
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id')
          .eq('workspace_id', workspace.id)
          .eq('customer_id', customer.customer_id)
          .maybeSingle();

        if (existingCustomer) {
          const { error } = await supabase
            .from('customers')
            .update(customerData)
            .eq('id', existingCustomer.id)
            .eq('workspace_id', workspace.id); // Double-check workspace_id

          if (error) throw error;
          updated++;
        } else {
          const { error } = await supabase
            .from('customers')
            .insert(customerData);

          if (error) throw error;
          inserted++;
        }
      } catch (error) {
        console.error('Error processing customer:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${customer.customer_id}: ${errorMessage}`);
      }
    }

    // Enhanced audit logging with metadata
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('x-real-ip') ||
                     'unknown';
    
    await supabase
      .from('webhook_logs')
      .insert({
        workspace_id: workspace.id,
        direction: 'inbound',
        webhook_url: req.url,
        payload: { customer_count: customers.length }, // Don't log full payload for privacy
        status_code: 200,
        response_payload: { inserted, updated, errors: errors.length },
        metadata: {
          client_ip: clientIP,
          auth_method: isHmacValid ? 'hmac' : 'shared_secret',
          user_agent: req.headers.get('user-agent')?.substring(0, 200),
        }
      });

    const response = {
      success: true,
      workspace_id: workspace.id,
      inserted,
      updated,
      total: customers.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log('Apify webhook processed:', response);

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in receive-apify-data:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage
      }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
