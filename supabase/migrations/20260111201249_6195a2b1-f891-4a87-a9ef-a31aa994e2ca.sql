-- Add storage policies for documents bucket (if not already added)
DO $$
BEGIN
  -- Check if policies exist before creating
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage' 
    AND policyname = 'Users can upload documents'
  ) THEN
    CREATE POLICY "Users can upload documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage' 
    AND policyname = 'Users can read their documents'
  ) THEN
    CREATE POLICY "Users can read their documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage' 
    AND policyname = 'Users can delete their documents'
  ) THEN
    CREATE POLICY "Users can delete their documents"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'documents');
  END IF;
END $$;

-- Add index for document_chunks embedding search if not exists
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
  WITH (lists = 100);