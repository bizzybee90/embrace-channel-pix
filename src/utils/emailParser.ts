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
