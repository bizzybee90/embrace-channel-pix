
-- Fix 1: Harden email-assets storage bucket with workspace scoping, file type and size limits

-- Update bucket with file size limit and allowed mime types
UPDATE storage.buckets 
SET file_size_limit = 2097152, -- 2MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp']
WHERE id = 'email-assets';

-- Drop overly permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can upload email assets" ON storage.objects;

-- Create workspace-scoped INSERT policy
CREATE POLICY "Users can upload to their workspace email assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'email-assets' AND 
    (storage.foldername(name))[1] IN (
      SELECT u.workspace_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

-- Drop any existing UPDATE/DELETE policies and add workspace-scoped ones
DROP POLICY IF EXISTS "Users can update their workspace email assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their workspace email assets" ON storage.objects;

CREATE POLICY "Users can update their workspace email assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'email-assets' AND 
    (storage.foldername(name))[1] IN (
      SELECT u.workspace_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their workspace email assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'email-assets' AND 
    (storage.foldername(name))[1] IN (
      SELECT u.workspace_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );
