import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import DOMPurify from 'dompurify';

interface HtmlEmailViewerProps {
  htmlContent: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Sanitize HTML using DOMPurify for comprehensive XSS protection
const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['html', 'head', 'body', 'meta', 'style', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup', 'col', 'div', 'span', 'img', 'a', 'b', 'i', 'strong', 'em', 'br', 'p', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'font', 'center', 'u', 's', 'strike', 'sub', 'sup', 'small', 'big'],
    ALLOWED_ATTR: ['style', 'class', 'id', 'href', 'src', 'alt', 'title', 'width', 'height', 'cellpadding', 'cellspacing', 'border', 'align', 'valign', 'bgcolor', 'color', 'face', 'size', 'target', 'rel', 'colspan', 'rowspan', 'charset', 'name', 'content', 'http-equiv'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'], // Allow target for links
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur'],
  });
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
          word-break: break-word;
        }
        td, th {
          word-break: break-word;
          overflow-wrap: break-word;
        }
        @media (max-width: 600px) {
          table { width: 100% !important; }
          td, th { display: block !important; width: 100% !important; }
          img { max-width: 100% !important; height: auto !important; }
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
      <DialogContent className="max-w-4xl flex flex-col p-0 mx-4 h-[80dvh] w-[calc(100vw-2rem)] rounded-2xl sm:rounded-2xl sm:h-[80vh] sm:w-auto sm:mx-auto">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">Formatted Email</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenInNewTab}
                className="gap-1.5 rounded-xl"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in new tab
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden bg-white rounded-b-3xl">
          <iframe
            srcDoc={styledHtml}
            sandbox=""
            className="w-full h-full border-0"
            title="Email content"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
