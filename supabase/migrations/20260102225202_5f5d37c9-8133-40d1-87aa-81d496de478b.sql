-- First, delete duplicate entries keeping only the oldest one per workspace_id + url
DELETE FROM competitor_sites a
USING competitor_sites b
WHERE a.workspace_id = b.workspace_id 
  AND a.url = b.url 
  AND a.created_at > b.created_at;

-- Now add the unique constraint
ALTER TABLE competitor_sites 
ADD CONSTRAINT competitor_sites_workspace_url_unique 
UNIQUE (workspace_id, url);