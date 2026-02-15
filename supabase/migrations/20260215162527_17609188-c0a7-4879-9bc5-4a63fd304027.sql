CREATE POLICY "Users can update their workspace email queue"
  ON email_import_queue FOR UPDATE
  USING (workspace_id = get_my_workspace_id())
  WITH CHECK (workspace_id = get_my_workspace_id());