import { cn } from '@/lib/utils';
import { getCategoryInfo, formatEmailTime, isOutbound } from '@/lib/emailDirection';
import type { InboxEmail } from '@/hooks/useInboxEmails';

interface EmailListItemProps {
  email: InboxEmail;
  isSelected: boolean;
  onClick: () => void;
}

export const EmailListItem = ({ email, isSelected, onClick }: EmailListItemProps) => {
  const catInfo = getCategoryInfo(email.category);
  const outbound = isOutbound(email.from_email);
  const senderName = email.from_name || email.from_email || 'Unknown';
  const bodyPreview = (email.body || '').replace(/\s+/g, ' ').slice(0, 80);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors flex flex-col gap-0.5 group',
        isSelected
          ? 'bg-accent/70'
          : 'hover:bg-accent/30',
        outbound && 'opacity-70'
      )}
    >
      {/* Row 1: Sender + Time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {email.requires_reply && !outbound && (
            <span className="h-2 w-2 rounded-full bg-destructive flex-shrink-0" />
          )}
          <span className="text-sm font-medium text-foreground truncate">
            {outbound ? `To: ${(email.to_emails?.[0] || '').split('@')[0]}` : senderName}
          </span>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
          {formatEmailTime(email.received_at)}
        </span>
      </div>

      {/* Row 2: Subject + Category */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-foreground/80 truncate flex-1">
          {email.subject || '(no subject)'}
        </span>
        {email.category && (
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0', catInfo.bg, catInfo.text)}>
            {catInfo.label}
          </span>
        )}
      </div>

      {/* Row 3: Preview */}
      <p className="text-xs text-muted-foreground truncate">
        {bodyPreview || '(no content)'}
      </p>

      {/* Confidence warning */}
      {email.confidence != null && email.confidence < 0.7 && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">
          {Math.round(email.confidence * 100)}% confidence
        </span>
      )}
    </button>
  );
};
