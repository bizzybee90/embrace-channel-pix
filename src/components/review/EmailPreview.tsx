import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Reply } from 'lucide-react';
import { parseEmailThread, cleanEmailContent } from '@/utils/emailParser';

interface EmailPreviewProps {
  body: string;
  summary?: string;
  maxLength?: number;
}

export function EmailPreview({ body, summary, maxLength = 500 }: EmailPreviewProps) {
  const [showQuoted, setShowQuoted] = useState(false);
  
  const { mainContent, quotedContent, hasQuotes } = useMemo(() => {
    if (!body) {
      return { 
        mainContent: summary || 'No preview available', 
        quotedContent: '', 
        hasQuotes: false 
      };
    }

    const segments = parseEmailThread(body);
    
    // Get main (non-quoted) content
    const mainSegments = segments.filter(s => !s.isQuoted);
    const quotedSegments = segments.filter(s => s.isQuoted);
    
    let main = mainSegments.map(s => s.content).join('\n\n');
    
    // Truncate main content if too long
    if (main.length > maxLength) {
      main = main.substring(0, maxLength).trim() + '...';
    }
    
    const quoted = quotedSegments.map(s => {
      const attr = s.attribution 
        ? `${s.attribution.sender}${s.attribution.date ? ` • ${s.attribution.date}` : ''}`
        : 'Previous message';
      return `--- ${attr} ---\n${s.content}`;
    }).join('\n\n');
    
    return {
      mainContent: main || cleanEmailContent(body).substring(0, maxLength),
      quotedContent: quoted,
      hasQuotes: quotedSegments.length > 0,
    };
  }, [body, summary, maxLength]);

  return (
    <div className="bg-muted/50 rounded-lg p-4 mb-4 flex-1 max-h-64 overflow-y-auto">
      <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
        {mainContent}
      </p>
      
      {hasQuotes && (
        <div className="mt-3 pt-2 border-t border-border/50">
          <button
            onClick={() => setShowQuoted(!showQuoted)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showQuoted ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Reply className="h-3 w-3" />
            <span>{showQuoted ? 'Hide' : 'Show'} previous messages</span>
          </button>
          
          {showQuoted && (
            <div className="mt-2 pl-3 border-l-2 border-muted-foreground/20">
              <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                {quotedContent}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
