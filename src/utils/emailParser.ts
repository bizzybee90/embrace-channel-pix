/**
 * Cleans email content by stripping signatures, quoted replies, and legal disclaimers
 */
export function cleanEmailContent(rawContent: string): string {
  if (!rawContent) return '';
  
  let content = rawContent;
  
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
