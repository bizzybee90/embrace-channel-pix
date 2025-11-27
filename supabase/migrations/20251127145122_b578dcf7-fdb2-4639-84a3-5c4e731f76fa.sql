-- Create storage bucket for message attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  20971520, -- 20MB limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
);

-- Allow authenticated users to upload attachments
CREATE POLICY "Users can upload message attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments' AND
  (storage.foldername(name))[1] IN (
    SELECT c.id::text
    FROM conversations c
    INNER JOIN users u ON u.workspace_id = c.workspace_id
    WHERE u.id = auth.uid()
  )
);

-- Allow users to view attachments from their workspace conversations
CREATE POLICY "Users can view workspace message attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'message-attachments' AND
  (storage.foldername(name))[1] IN (
    SELECT c.id::text
    FROM conversations c
    INNER JOIN users u ON u.workspace_id = c.workspace_id
    WHERE u.id = auth.uid()
  )
);

-- Allow users to delete attachments from their conversations
CREATE POLICY "Users can delete message attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'message-attachments' AND
  (storage.foldername(name))[1] IN (
    SELECT c.id::text
    FROM conversations c
    INNER JOIN users u ON u.workspace_id = c.workspace_id
    WHERE u.id = auth.uid()
  )
);