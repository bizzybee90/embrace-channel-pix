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
import { ExternalLink, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type CompetitorRow = {
  business_name: string | null;
  url: string;
  domain: string;
  rating: number | null;
  reviews_count: number | null;
};

export function CompetitorListDialog({
  jobId,
  disabled,
  className,
}: {
  jobId: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<CompetitorRow[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("competitor_sites")
        .select("business_name,url,domain,rating,reviews_count")
        .eq("job_id", jobId)
        .order("discovered_at", { ascending: false, nullsFirst: false })
        .limit(200);

      if (!cancelled) {
        if (error) {
          // Keep UI simple: empty list rather than hard error.
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
          <ExternalLink className="h-4 w-4" />
          View competitors
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Competitors found</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or domain"
              className="pl-10"
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading competitors…
            </div>
          ) : (
            <ScrollArea className="h-[420px] rounded-md border">
              <div className="divide-y">
                {filtered.map((r) => (
                  <a
                    key={`${r.domain}:${r.url}`}
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {r.business_name ?? r.domain}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{r.domain}</div>
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {r.rating != null ? `${r.rating.toFixed(1)}★` : ""}
                        {r.reviews_count != null ? ` · ${r.reviews_count}` : ""}
                      </div>
                    </div>
                  </a>
                ))}

                {filtered.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No competitors to show yet.
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
