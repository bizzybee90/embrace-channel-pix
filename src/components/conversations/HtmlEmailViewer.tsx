import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, X } from 'lucide-react';

interface HtmlEmailViewerProps {
  htmlContent: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Sanitize HTML by removing script tags and event handlers
const sanitizeHtml = (html: string): string => {
  // Remove script tags
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove event handlers
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  return sanitized;
};

export function HtmlEmailViewer({ htmlContent, open, onOpenChange }: HtmlEmailViewerProps) {
  const sanitizedHtml = sanitizeHtml(htmlContent);
  
  // Add basic styling wrapper for the email content
  const styledHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #1a1a1a;
          background: #ffffff;
          padding: 16px;
          margin: 0;
          max-width: 100%;
          overflow-x: hidden;
        }
        img {
          max-width: 100%;
          height: auto;
        }
        a {
          color: #2563eb;
        }
        table {
          max-width: 100%;
        }
      </style>
    </head>
    <body>
      ${sanitizedHtml}
    </body>
    </html>
  `;

  const handleOpenInNewTab = () => {
    const blob = new Blob([styledHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Revoke after a delay to ensure the tab has loaded
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">Formatted Email</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenInNewTab}
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in new tab
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden bg-white rounded-b-lg">
          <iframe
            srcDoc={styledHtml}
            sandbox="allow-same-origin"
            className="w-full h-full border-0"
            title="Email content"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
