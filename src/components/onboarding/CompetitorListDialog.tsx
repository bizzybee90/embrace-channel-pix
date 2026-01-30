import { useEffect, useMemo, useState, useCallback, type MouseEvent } from "react";
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
  Building2,
  Trash2,
  Sparkles
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

type SearchSuggestion = {
  url: string;
  domain: string;
  title: string;
  description?: string;
};

export function CompetitorListDialog({
  jobId,
  workspaceId,
  serviceArea,
  disabled,
  className,
}: {
  jobId: string;
  workspaceId?: string;
  serviceArea?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<CompetitorRow[]>([]);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
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

  // Debounced search for suggestions
  const searchForSuggestions = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('competitor-search-suggest', {
        body: { query: searchQuery, location: serviceArea }
      });

      if (error) throw error;

      // Filter out already-added domains
      const existingDomains = new Set(rows.map(r => r.domain.toLowerCase()));
      const filtered = (data?.suggestions || []).filter(
        (s: SearchSuggestion) => !existingDomains.has(s.domain.toLowerCase())
      );

      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } catch (err) {
      console.error('Search error:', err);
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, [serviceArea, rows]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim().length >= 3) {
        searchForSuggestions(searchInput);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, searchForSuggestions]);

  const handleAddFromSuggestion = async (suggestion: SearchSuggestion) => {
    if (!workspaceId) return;

    // Check if already exists
    if (rows.some(r => r.domain.toLowerCase() === suggestion.domain.toLowerCase())) {
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
          business_name: suggestion.title || suggestion.domain,
          url: suggestion.url,
          domain: suggestion.domain,
          discovery_source: 'search',
          status: 'approved',
          scrape_status: 'pending',
          is_selected: true,
        })
        .select('id,business_name,url,domain,rating,reviews_count,discovery_source')
        .single();

      if (error) throw error;

      setRows(prev => [data as CompetitorRow, ...prev]);
      setSearchInput('');
      setSuggestions([]);
      setShowSuggestions(false);
      toast.success(`Added ${suggestion.domain}`);
    } catch (err) {
      console.error('Error adding competitor:', err);
      toast.error('Failed to add competitor');
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleAddManualUrl = async () => {
    if (!searchInput.trim() || !workspaceId) return;

    let cleanUrl = searchInput.trim();
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
      setSearchInput('');
      setSuggestions([]);
      setShowSuggestions(false);
      toast.success('Competitor added successfully');
    } catch (err) {
      console.error('Error adding URL:', err);
      toast.error('Failed to add competitor');
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleRemoveCompetitor = async (competitorId: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const ok = window.confirm("Remove this competitor from the list?");
    if (!ok) return;

    // Optimistic update
    setRows(prev => prev.filter(r => r.id !== competitorId));

    const { error } = await supabase
      .from('competitor_sites')
      .delete()
      .eq('id', competitorId);

    if (error) {
      // Refetch on error
      toast.error('Failed to remove competitor');
      // Reload data
      const { data } = await supabase
        .from("competitor_sites")
        .select("id,business_name,url,domain,rating,reviews_count,discovery_source")
        .eq("job_id", jobId)
        .order("rating", { ascending: false, nullsFirst: false })
        .limit(200);
      if (data) setRows(data as CompetitorRow[]);
    } else {
      toast.success('Competitor removed');
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
          {/* Search to add competitors */}
          {workspaceId && (
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddManualUrl()}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Search or add URL (e.g., window cleaning bicester)"
                    className="pl-10 bg-background border-border"
                    disabled={isAddingUrl}
                  />
                </div>
                <Button
                  onClick={handleAddManualUrl}
                  disabled={!searchInput.trim() || isAddingUrl}
                  size="icon"
                  className="shrink-0"
                  title="Add as URL"
                >
                  {isAddingUrl ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Search suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                  <div className="p-1 max-h-[240px] overflow-auto">
                    {isSearching && (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </div>
                    )}
                    {suggestions.map((s) => (
                      <button
                        key={s.url}
                        onClick={() => handleAddFromSuggestion(s)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-muted transition-colors"
                      >
                        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-foreground truncate">
                            {s.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {s.domain}
                          </div>
                        </div>
                        <Plus className="h-4 w-4 text-primary shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isSearching && !showSuggestions && (
                <div className="absolute right-12 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}

          {/* Filter existing list */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter list..."
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
                  <div
                    key={r.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-all overflow-hidden"
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
                      <Badge variant="secondary" className="shrink-0 tabular-nums">
                        <Star className="h-3.5 w-3.5 mr-1" />
                        {r.rating.toFixed(1)}
                        {r.reviews_count != null ? ` (${r.reviews_count})` : ""}
                      </Badge>
                    )}

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        asChild
                        className="h-8 w-8"
                      >
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Open website"
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </a>
                      </Button>

                      {workspaceId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => handleRemoveCompetitor(r.id, e)}
                          aria-label="Remove competitor"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
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
