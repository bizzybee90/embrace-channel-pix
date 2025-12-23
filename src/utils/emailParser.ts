/**
 * Decodes HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&zwnj;/g, '')              // Remove zero-width non-joiner
    .replace(/&#8203;/g, '')             // Zero-width space
    .replace(/&#x200b;/g, '')            // Zero-width space (hex)
    .replace(/&#160;/g, ' ')             // Non-breaking space (numeric)
    .replace(/&nbsp;/g, ' ')             // Non-breaking space (named)
    .replace(/&#xa0;/g, ' ')             // Non-breaking space (hex)
    .replace(/&amp;/g, '&')              // Ampersand
    .replace(/&lt;/g, '<')               // Less than
    .replace(/&gt;/g, '>')               // Greater than
    .replace(/&quot;/g, '"')             // Quote
    .replace(/&#39;/g, "'")              // Apostrophe
    .replace(/&apos;/g, "'")             // Apostrophe (named)
    .replace(/&#34;/g, '"')              // Quote (numeric)
    .replace(/&copy;/g, '©')             // Copyright
    .replace(/&reg;/g, '®')              // Registered
    .replace(/&trade;/g, '™')            // Trademark
    .replace(/&sup1;/g, '¹')             // Superscript 1
    .replace(/&sup2;/g, '²')             // Superscript 2
    .replace(/&sup3;/g, '³')             // Superscript 3
    .replace(/&bull;/g, '•')             // Bullet
    .replace(/&middot;/g, '·')           // Middle dot
    .replace(/&hellip;/g, '...')         // Ellipsis
    .replace(/&ndash;/g, '-')            // En dash
    .replace(/&mdash;/g, '—')            // Em dash
    .replace(/&#\d+;/g, '')              // Remove any remaining numeric entities
    .replace(/&[a-zA-Z]+;/g, '')         // Remove any remaining named entities
    .replace(/\s{3,}/g, ' ')             // Collapse excessive whitespace
    .trim();
}

/**
 * Cleans email content by stripping signatures, quoted replies, and legal disclaimers
 */
export function cleanEmailContent(rawContent: string): string {
  if (!rawContent) return '';
  
  // First decode HTML entities
  let content = decodeHtmlEntities(rawContent);
  
  // Remove quoted replies (lines starting with >)
  content = content.replace(/^>.*$/gm, '');
  
  // Remove "On [date] [person] wrote:" and everything after (works inline too)
  content = content.replace(/On \d{1,2} .{3,20} \d{4},? at \d{1,2}:\d{2}.*wrote:[\s\S]*/i, '');
  content = content.replace(/On .{10,60} wrote:[\s\S]*/i, '');
  
  // Cut everything after these markers (inline or line-start) using indexOf
  const cutoffPatterns = [
    'Confidentiality Note:',
    'This e-mail and any attachments',
    'This email and any attachments',
    'This message is intended',
    '#FollowUs',
    'Follow us on',
    'Sent from my iPhone',
    'Sent from my Android',
    'Get Outlook for',
    'Get Outlook for iOS',
    'Get Outlook for Android',
    '-- \n',
    '---',
    '___',
  ];
  
  for (const pattern of cutoffPatterns) {
    const index = content.indexOf(pattern);
    if (index > 0) {
      content = content.substring(0, index);
    }
  }
  
  // Also cut at website URLs that look like signature elements (e.g., www.maccleaning.uk)
  const urlSignatureMatch = content.match(/\s(www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
  if (urlSignatureMatch && urlSignatureMatch.index) {
    // Only cut if URL appears in latter half of message (likely signature)
    if (urlSignatureMatch.index > content.length * 0.5) {
      content = content.substring(0, urlSignatureMatch.index);
    }
  }
  
  // Cut at standalone email addresses (likely signature)
  const emailSignatureMatch = content.match(/\s([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s/);
  if (emailSignatureMatch && emailSignatureMatch.index) {
    if (emailSignatureMatch.index > content.length * 0.5) {
      content = content.substring(0, emailSignatureMatch.index);
    }
  }
  
  // Clean up whitespace
  content = content.replace(/\n{3,}/g, '\n\n').trim();
  
  return content;
}

/**
 * Checks if the email content has been significantly cleaned
 * (useful for deciding whether to show "Show original" toggle)
 */
export function hasSignificantCleaning(rawContent: string, cleanedContent: string): boolean {
  if (!rawContent || !cleanedContent) return false;
  
  const rawLength = rawContent.length;
  const cleanedLength = cleanedContent.length;
  
  // If we removed more than 20% of the content, it's significant
  return (rawLength - cleanedLength) / rawLength > 0.2;
}

/**
 * Thread segment structure for email threading
 */
export interface ThreadSegment {
  content: string;
  isQuoted: boolean;
  depth: number;
  attribution?: {
    sender: string;
    date: string;
  };
}

/**
 * Parses email content into thread segments for threading display
 */
export function parseEmailThread(rawContent: string): ThreadSegment[] {
  if (!rawContent) return [];
  
  const content = decodeHtmlEntities(rawContent);
  const segments: ThreadSegment[] = [];
  
  // Pattern to match "On [date], [person] wrote:" variations
  const quotePatterns = [
    /On (.+?),?\s+(.+?) wrote:/gi,
    /On (.+?) at (\d{1,2}:\d{2}),?\s+(.+?) wrote:/gi,
    /From:\s*(.+?)[\r\n]/gi,
    /^>+ ?/gm,
  ];
  
  // Find the first quote marker
  const quoteMatch = content.match(/On .+? wrote:/i);
  const fromMatch = content.match(/From:\s*.+?[\r\n]/i);
  const gtMatch = content.match(/^>+ ?/m);
  
  // Determine the earliest quote start
  let quoteStart = -1;
  let attribution: ThreadSegment['attribution'] | undefined;
  
  if (quoteMatch) {
    const idx = content.indexOf(quoteMatch[0]);
    if (quoteStart === -1 || idx < quoteStart) {
      quoteStart = idx;
      // Extract attribution
      const attrMatch = quoteMatch[0].match(/On (.+?),?\s+(.+?) wrote:/i);
      if (attrMatch) {
        attribution = {
          date: attrMatch[1].trim(),
          sender: attrMatch[2].trim(),
        };
      }
    }
  }
  
  if (fromMatch) {
    const idx = content.indexOf(fromMatch[0]);
    if (quoteStart === -1 || idx < quoteStart) {
      quoteStart = idx;
      const senderMatch = fromMatch[0].match(/From:\s*(.+?)[\r\n]/i);
      if (senderMatch) {
        attribution = {
          sender: senderMatch[1].trim(),
          date: '',
        };
      }
    }
  }
  
  if (gtMatch) {
    const idx = content.search(/^>+ ?/m);
    if (quoteStart === -1 || idx < quoteStart) {
      quoteStart = idx;
      attribution = undefined;
    }
  }
  
  // If no quotes found, return single segment
  if (quoteStart === -1) {
    return [{
      content: cleanEmailContent(content),
      isQuoted: false,
      depth: 0,
    }];
  }
  
  // Split into main content and quoted content
  const mainContent = content.substring(0, quoteStart).trim();
  const quotedContent = content.substring(quoteStart).trim();
  
  if (mainContent) {
    segments.push({
      content: cleanEmailContent(mainContent),
      isQuoted: false,
      depth: 0,
    });
  }
  
  // Parse quoted content recursively
  if (quotedContent) {
    // Clean the quoted content but preserve it
    let cleanedQuote = quotedContent;
    
    // Remove the "On X wrote:" line itself from the display
    cleanedQuote = cleanedQuote.replace(/^On .+? wrote:\s*/i, '');
    cleanedQuote = cleanedQuote.replace(/^From:\s*.+?[\r\n]/i, '');
    
    // Remove > prefixes
    cleanedQuote = cleanedQuote.replace(/^>+ ?/gm, '');
    
    // Check for nested quotes
    const nestedQuoteMatch = cleanedQuote.match(/On .+? wrote:/i);
    
    if (nestedQuoteMatch) {
      const nestedIdx = cleanedQuote.indexOf(nestedQuoteMatch[0]);
      const firstQuotePart = cleanedQuote.substring(0, nestedIdx).trim();
      const nestedPart = cleanedQuote.substring(nestedIdx);
      
      if (firstQuotePart) {
        segments.push({
          content: cleanEmailContent(firstQuotePart),
          isQuoted: true,
          depth: 1,
          attribution,
        });
      }
      
      // Parse the nested part
      const nestedAttrMatch = nestedQuoteMatch[0].match(/On (.+?),?\s+(.+?) wrote:/i);
      let nestedQuoteContent = nestedPart.replace(/^On .+? wrote:\s*/i, '');
      nestedQuoteContent = nestedQuoteContent.replace(/^>+ ?/gm, '');
      
      segments.push({
        content: cleanEmailContent(nestedQuoteContent),
        isQuoted: true,
        depth: 2,
        attribution: nestedAttrMatch ? {
          date: nestedAttrMatch[1].trim(),
          sender: nestedAttrMatch[2].trim(),
        } : undefined,
      });
    } else {
      segments.push({
        content: cleanEmailContent(cleanedQuote),
        isQuoted: true,
        depth: 1,
        attribution,
      });
    }
  }
  
  return segments;
}
