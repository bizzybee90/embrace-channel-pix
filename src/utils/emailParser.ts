/**
 * Cleans email content by stripping signatures, quoted replies, and legal disclaimers
 */
export function cleanEmailContent(rawContent: string): string {
  if (!rawContent) return '';
  
  let content = rawContent;
  
  // Remove quoted replies (lines starting with >)
  content = content.replace(/^>.*$/gm, '');
  
  // Remove "On [date] [person] wrote:" blocks and everything after
  content = content.replace(/On .+wrote:[\s\S]*/i, '');
  
  // Remove common signature markers and everything after
  const signatureMarkers = [
    /^--\s*$/m,                              // Standard -- marker
    /^_{3,}/m,                               // ___ underscores
    /^-{3,}/m,                               // --- dashes
    /^Sent from my/im,                       // Mobile signatures
    /^Get Outlook/im,                        // Outlook mobile
    /^Confidentiality Note:/im,              // Confidentiality notices
    /^This e-?mail and any attachments/im,   // Legal disclaimers
    /^This message is intended/im,           // Intent disclaimers
    /^#FollowUs/im,                          // Social media footers
    /^Follow us on/im,                       // Social media footers
    /^Kind regards,?$/im,                    // Sign-offs followed by signature
    /^Best regards,?$/im,                    // Sign-offs
    /^Thanks,?$/im,                          // Sign-offs
    /^Cheers,?$/im,                          // Sign-offs
    /^Regards,?$/im,                         // Sign-offs
    /^www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/m,    // Website URLs as signature start
    /^https?:\/\/[^\s]+$/m,                  // Standalone URLs on their own line
  ];
  
  for (const marker of signatureMarkers) {
    const match = content.match(marker);
    if (match && match.index !== undefined) {
      content = content.substring(0, match.index);
    }
  }
  
  // Remove email addresses that look like signature elements
  content = content.replace(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/gm, '');
  
  // Remove phone numbers on their own line (likely signature)
  content = content.replace(/^\+?[\d\s()-]{10,}$/gm, '');
  
  // Clean up extra whitespace
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
