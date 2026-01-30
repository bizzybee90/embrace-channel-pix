import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  ExternalLink, 
  Loader2, 
  Search, 
  Plus, 
  Globe, 
  Star,
  Building2
} from "lucide-react";
import { cn } from "@/lib/utils";

type CompetitorRow = {
  id: string;
  business_name: string | null;
  url: string;
  domain: string;
  rating: number | null;
  reviews_count: number | null;
  discovery_source: string | null;
};

export function CompetitorListDialog({
  jobId,
  workspaceId,
  disabled,
  className,
}: {
  jobId: string;
  workspaceId?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<CompetitorRow[]>([]);
  const [query, setQuery] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("competitor_sites")
        .select("id,business_name,url,domain,rating,reviews_count,discovery_source")
        .eq("job_id", jobId)
        .order("rating", { ascending: false, nullsFirst: false })
        .limit(200);

      if (!cancelled) {
        if (error) {
          setRows([]);
        } else {
          setRows((data ?? []) as CompetitorRow[]);
        }
        setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = (r.business_name ?? "").toLowerCase();
      const url = r.url.toLowerCase();
      const domain = r.domain.toLowerCase();
      return name.includes(q) || url.includes(q) || domain.includes(q);
    });
  }, [query, rows]);

  const handleAddManualUrl = async () => {
    if (!manualUrl.trim() || !workspaceId) return;

    let cleanUrl = manualUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    let hostname: string;
    try {
      hostname = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      toast.error('Invalid URL format');
      return;
    }

    // Check if already exists
    if (rows.some(r => r.domain === hostname || r.url === cleanUrl)) {
      toast.error('This website is already in the list');
      return;
    }

    setIsAddingUrl(true);
    try {
      const { data, error } = await supabase
        .from('competitor_sites')
        .insert({
          job_id: jobId,
          workspace_id: workspaceId,
          business_name: hostname,
          url: cleanUrl,
          domain: hostname,
          discovery_source: 'manual',
          status: 'approved',
          scrape_status: 'pending',
          is_selected: true,
        })
        .select('id,business_name,url,domain,rating,reviews_count,discovery_source')
        .single();

      if (error) throw error;

      setRows(prev => [data as CompetitorRow, ...prev]);
      setManualUrl('');
      toast.success('Competitor added successfully');
    } catch (err) {
      console.error('Error adding URL:', err);
      toast.error('Failed to add competitor');
    } finally {
      setIsAddingUrl(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn("gap-2", className)}
        >
          <Building2 className="h-4 w-4" />
          View competitors
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl bg-background border-border overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Building2 className="h-5 w-5 text-primary" />
            Competitors found
            <Badge variant="secondary" className="ml-2">
              {rows.length}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-hidden">
          {/* Add manual URL section */}
          {workspaceId && (
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddManualUrl()}
                  placeholder="Add competitor URL (e.g., example.com)"
                  className="pl-10 bg-background border-border"
                  disabled={isAddingUrl}
                />
              </div>
              <Button
                onClick={handleAddManualUrl}
                disabled={!manualUrl.trim() || isAddingUrl}
                size="icon"
                className="shrink-0"
              >
                {isAddingUrl ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or domain..."
              className="pl-10 bg-background border-border"
            />
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading competitors…</p>
            </div>
          ) : (
            <ScrollArea className="h-[380px] rounded-lg border border-border bg-muted/20">
              <div className="p-2 space-y-1">
                {filtered.map((r) => (
                  <a
                    key={r.id}
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-all group overflow-hidden"
                  >
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Globe className="h-5 w-5 text-primary" />
                    </div>
                    
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="font-medium text-foreground truncate block">
                          {r.business_name ?? r.domain}
                        </span>
                        {r.discovery_source === 'manual' && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            Manual
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.domain}
                      </div>
                    </div>

                    {r.rating != null && (
                      <div className="flex items-center gap-1 text-sm shrink-0">
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                        <span className="font-medium text-foreground">{r.rating.toFixed(1)}</span>
                        {r.reviews_count != null && (
                          <span className="text-muted-foreground text-xs">
                            ({r.reviews_count})
                          </span>
                        )}
                      </div>
                    )}
                    
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </a>
                ))}

                {filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Building2 className="h-10 w-10 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {query ? 'No competitors match your search' : 'No competitors found yet'}
                    </p>
                    {workspaceId && !query && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Add one manually using the field above
                      </p>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
