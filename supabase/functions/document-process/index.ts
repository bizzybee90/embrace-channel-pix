import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  workspace_id: string;
  document_id?: string;
  action: 'process' | 'list' | 'delete';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'document-process';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: ProcessRequest = await req.json();
    console.log(`[${functionName}] Request:`, body);

    if (!body.workspace_id) throw new Error('workspace_id is required');

    const action = body.action || 'process';

    // List documents
    if (action === 'list') {
      const { data: documents, error } = await supabase
        .from('documents')
        .select('id, name, file_type, file_size, status, page_count, processed_at, created_at')
        .eq('workspace_id', body.workspace_id)
        .order('created_at', { ascending: false });

      return new Response(
        JSON.stringify({ success: true, documents: documents || [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete document
    if (action === 'delete' && body.document_id) {
      // Delete chunks first
      await supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', body.document_id);

      // Delete document record
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', body.document_id)
        .eq('workspace_id', body.workspace_id);

      if (deleteError) throw deleteError;

      return new Response(
        JSON.stringify({ success: true, message: 'Document deleted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process document
    if (!body.document_id) throw new Error('document_id is required for processing');

    // Get document details
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', body.document_id)
      .eq('workspace_id', body.workspace_id)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Update status to processing
    await supabase
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', body.document_id);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('documents')
      .download(document.file_path);

    if (downloadError || !fileData) {
      await supabase
        .from('documents')
        .update({ status: 'error', error_message: 'Failed to download file' })
        .eq('id', body.document_id);
      throw new Error('Failed to download file from storage');
    }

    // Convert to text (basic text extraction)
    let extractedText = '';
    const fileType = document.file_type.toLowerCase();

    if (fileType.includes('text') || fileType.includes('txt')) {
      extractedText = await fileData.text();
    } else if (fileType.includes('json')) {
      const json = await fileData.text();
      extractedText = JSON.stringify(JSON.parse(json), null, 2);
    } else {
      // For PDFs and other formats, we'd need specialized processing
      // For now, try to extract any text content
      try {
        extractedText = await fileData.text();
      } catch {
        extractedText = 'Unable to extract text from this file format';
      }
    }

    console.log(`[${functionName}] Extracted ${extractedText.length} characters from ${document.name}`);

    // Chunk the text (max ~1000 tokens per chunk for good embedding quality)
    const CHUNK_SIZE = 1500;
    const CHUNK_OVERLAP = 200;
    const chunks: string[] = [];
    
    if (extractedText.length > 0) {
      let position = 0;
      while (position < extractedText.length) {
        const chunk = extractedText.slice(position, position + CHUNK_SIZE);
        if (chunk.trim().length > 50) { // Only add meaningful chunks
          chunks.push(chunk);
        }
        position += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }

    console.log(`[${functionName}] Created ${chunks.length} chunks`);

    // Generate embeddings for chunks using OpenAI
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const chunksWithEmbeddings: any[] = [];

    if (OPENAI_API_KEY && chunks.length > 0) {
      for (let i = 0; i < chunks.length; i++) {
        try {
          const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: chunks[i]
            })
          });

          if (embeddingResponse.ok) {
            const embeddingData = await embeddingResponse.json();
            chunksWithEmbeddings.push({
              document_id: body.document_id,
              workspace_id: body.workspace_id,
              chunk_index: i,
              content: chunks[i],
              page_number: Math.floor(i / 3) + 1, // Estimate page number
              embedding: JSON.stringify(embeddingData.data[0].embedding)
            });
          }
        } catch (e) {
          console.error(`[${functionName}] Embedding error for chunk ${i}:`, e);
          // Still store chunk without embedding
          chunksWithEmbeddings.push({
            document_id: body.document_id,
            workspace_id: body.workspace_id,
            chunk_index: i,
            content: chunks[i],
            page_number: Math.floor(i / 3) + 1
          });
        }
      }
    } else {
      // Store chunks without embeddings
      chunks.forEach((chunk, i) => {
        chunksWithEmbeddings.push({
          document_id: body.document_id,
          workspace_id: body.workspace_id,
          chunk_index: i,
          content: chunk,
          page_number: Math.floor(i / 3) + 1
        });
      });
    }

    // Store chunks
    if (chunksWithEmbeddings.length > 0) {
      // Delete existing chunks first
      await supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', body.document_id);

      const { error: insertError } = await supabase
        .from('document_chunks')
        .insert(chunksWithEmbeddings);

      if (insertError) {
        console.error(`[${functionName}] Failed to store chunks:`, insertError);
      }
    }

    // Generate FAQs from document content using AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    let generatedFaqs: any[] = [];

    if (LOVABLE_API_KEY && extractedText.length > 100) {
      const faqPrompt = `Extract FAQ-style question and answer pairs from this document content. Focus on useful information that could answer customer questions.

DOCUMENT: ${document.name}
CONTENT:
${extractedText.slice(0, 8000)}

---

Extract up to 10 FAQs. Return JSON array:
[
  {
    "question": "Clear question that a customer might ask",
    "answer": "Comprehensive answer from the document",
    "category": "Pricing|Services|Policies|Hours|General"
  }
]`;

      try {
        const faqResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LOVABLE_API_KEY}`
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'Extract FAQs from documents. Return valid JSON array only.' },
              { role: 'user', content: faqPrompt }
            ],
            temperature: 0.3
          })
        });

        if (faqResponse.ok) {
          const faqData = await faqResponse.json();
          const faqText = faqData.choices?.[0]?.message?.content || '';
          
          try {
            const jsonMatch = faqText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              generatedFaqs = JSON.parse(jsonMatch[0]);
              console.log(`[${functionName}] Generated ${generatedFaqs.length} FAQs from document`);
              
              // Store FAQs in faq_database
              if (generatedFaqs.length > 0) {
                const faqsToInsert = generatedFaqs.map(faq => ({
                  workspace_id: body.workspace_id,
                  question: faq.question,
                  answer: faq.answer,
                  category: faq.category || 'General',
                  source_url: `document://${document.name}`,
                  generation_source: 'document',
                  is_own_content: true
                }));

                await supabase
                  .from('faq_database')
                  .insert(faqsToInsert);
              }
            }
          } catch (parseError) {
            console.error(`[${functionName}] FAQ parsing error:`, parseError);
          }
        }
      } catch (faqError) {
        console.error(`[${functionName}] FAQ generation error:`, faqError);
      }
    }

    // Update document as processed
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'processed',
        extracted_text: extractedText.slice(0, 50000), // Store first 50k chars
        page_count: Math.ceil(chunks.length / 3),
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', body.document_id);

    if (updateError) {
      console.error(`[${functionName}] Failed to update document:`, updateError);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: body.document_id,
          name: document.name,
          chunks_created: chunksWithEmbeddings.length,
          faqs_generated: generatedFaqs.length,
          text_length: extractedText.length
        },
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
