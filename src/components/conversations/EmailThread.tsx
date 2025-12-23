import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseEmailThread, ThreadSegment } from '@/utils/emailParser';

interface EmailThreadProps {
  body: string;
  defaultExpanded?: boolean;
}

interface QuotedSectionProps {
  segment: ThreadSegment;
  isExpanded: boolean;
  onToggle: () => void;
}

function QuotedSection({ segment, isExpanded, onToggle }: QuotedSectionProps) {
  return (
    <div 
      className={cn(
        "mt-2 transition-all",
        segment.depth > 0 && "ml-3 pl-3 border-l-2 border-muted-foreground/20"
      )}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Reply className="h-3 w-3" />
        {segment.attribution ? (
          <span>
            {segment.attribution.sender} • {segment.attribution.date}
          </span>
        ) : (
          <span>Previous message</span>
        )}
      </button>
      
      {isExpanded && (
        <div className="mt-1 text-sm text-muted-foreground whitespace-pre-line leading-relaxed bg-muted/30 rounded p-2">
          {segment.content}
        </div>
      )}
    </div>
  );
}

export function EmailThread({ body, defaultExpanded = false }: EmailThreadProps) {
  const segments = useMemo(() => parseEmailThread(body), [body]);
  const [expandedQuotes, setExpandedQuotes] = useState<Set<number>>(new Set());

  const toggleQuote = (index: number) => {
    setExpandedQuotes(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    const quotedIndices = segments
      .map((seg, idx) => seg.isQuoted ? idx : -1)
      .filter(idx => idx >= 0);
    setExpandedQuotes(new Set(quotedIndices));
  };

  const collapseAll = () => {
    setExpandedQuotes(new Set());
  };

  const quotedCount = segments.filter(s => s.isQuoted).length;
  const allExpanded = expandedQuotes.size === quotedCount && quotedCount > 0;

  // If no quoted content, just render the body normally
  if (segments.length <= 1 && !segments[0]?.isQuoted) {
    return (
      <p className="text-sm whitespace-pre-line leading-relaxed">
        {body}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {/* Main content (non-quoted) */}
      {segments.map((segment, index) => {
        if (!segment.isQuoted) {
          return (
            <p key={index} className="text-sm whitespace-pre-line leading-relaxed">
              {segment.content}
            </p>
          );
        }

        return (
          <QuotedSection
            key={index}
            segment={segment}
            isExpanded={expandedQuotes.has(index)}
            onToggle={() => toggleQuote(index)}
          />
        );
      })}

      {/* Expand/Collapse all toggle */}
      {quotedCount > 1 && (
        <button
          onClick={allExpanded ? collapseAll : expandAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
        >
          {allExpanded ? 'Collapse all replies' : `Show all ${quotedCount} previous messages`}
        </button>
      )}
    </div>
  );
}
