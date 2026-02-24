import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Mail,
  AlertTriangle,
  ThumbsUp,
  UserPlus,
  MessageCircle,
  Receipt,
  Zap,
  Users,
  Bot,
  Ban,
  Megaphone,
  Briefcase,
  Settings2,
  Info,
  LucideIcon,
  Pencil,
} from 'lucide-react';

interface CategoryConfig {
  icon: LucideIcon;
  label: string;
  className: string;
}

// Unified premium indigo style for all category pills
const UNIFIED_PILL = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700';

const categoryConfigs: Record<string, CategoryConfig> = {
  // New 9-category taxonomy (primary keys)
  quote: { icon: Receipt, label: 'Quote', className: UNIFIED_PILL },
  booking: { icon: MessageCircle, label: 'Booking', className: UNIFIED_PILL },
  complaint: { icon: AlertTriangle, label: 'Complaint', className: UNIFIED_PILL },
  follow_up: { icon: MessageCircle, label: 'Follow-up', className: UNIFIED_PILL },
  inquiry: { icon: Mail, label: 'Enquiry', className: UNIFIED_PILL },
  notification: { icon: Bot, label: 'Auto', className: UNIFIED_PILL },
  newsletter: { icon: Megaphone, label: 'Marketing', className: UNIFIED_PILL },
  spam: { icon: Ban, label: 'Spam', className: UNIFIED_PILL },
  personal: { icon: Users, label: 'Personal', className: UNIFIED_PILL },

  // Legacy category keys (backwards compatibility)
  customer_inquiry: { icon: Mail, label: 'Enquiry', className: UNIFIED_PILL },
  customer_complaint: { icon: AlertTriangle, label: 'Complaint', className: UNIFIED_PILL },
  customer_feedback: { icon: ThumbsUp, label: 'Feedback', className: UNIFIED_PILL },
  complaint_dispute: { icon: AlertTriangle, label: 'Complaint', className: UNIFIED_PILL },
  
  // Specific request types
  booking_request: { icon: MessageCircle, label: 'Booking', className: UNIFIED_PILL },
  quote_request: { icon: Receipt, label: 'Quote', className: UNIFIED_PILL },
  cancellation_request: { icon: AlertTriangle, label: 'Cancel', className: UNIFIED_PILL },
  reschedule_request: { icon: MessageCircle, label: 'Reschedule', className: UNIFIED_PILL },
  
  // Lead categories
  lead_new: { icon: UserPlus, label: 'New Lead', className: UNIFIED_PILL },
  lead_followup: { icon: MessageCircle, label: 'Follow-up', className: UNIFIED_PILL },
  
  // Financial categories
  supplier_invoice: { icon: Receipt, label: 'Invoice', className: UNIFIED_PILL },
  supplier_urgent: { icon: Zap, label: 'Supplier Urgent', className: UNIFIED_PILL },
  receipt_confirmation: { icon: Receipt, label: 'Receipt', className: UNIFIED_PILL },
  payment_confirmation: { icon: Receipt, label: 'Payment', className: UNIFIED_PILL },
  
  // Partner/Business
  partner_request: { icon: Users, label: 'Partner', className: UNIFIED_PILL },
  
  // Automated/System
  automated_notification: { icon: Bot, label: 'Auto', className: UNIFIED_PILL },
  internal_system: { icon: Settings2, label: 'System', className: UNIFIED_PILL },
  informational_only: { icon: Info, label: 'Info', className: UNIFIED_PILL },
  
  // Noise categories
  spam_phishing: { icon: Ban, label: 'Spam', className: UNIFIED_PILL },
  marketing_newsletter: { icon: Megaphone, label: 'Marketing', className: UNIFIED_PILL },
  recruitment_hr: { icon: Briefcase, label: 'Recruitment', className: UNIFIED_PILL },
  misdirected: { icon: AlertTriangle, label: 'Misdirected', className: UNIFIED_PILL },
};

// Keyword-based fallback matching for non-standard classifications
const getConfigByKeyword = (classification: string): CategoryConfig | null => {
  const lower = classification.toLowerCase();
  
  // Payment/Receipt related
  if (lower.includes('payment') && (lower.includes('confirm') || lower.includes('received'))) {
    return { icon: Receipt, label: 'Payment', className: UNIFIED_PILL };
  }
  if (lower.includes('receipt') || lower.includes('stripe') || lower.includes('paypal')) {
    return { icon: Receipt, label: 'Receipt', className: UNIFIED_PILL };
  }
  
  // Invoice related
  if (lower.includes('invoice') || lower.includes('billing') || lower.includes('bill')) {
    return { icon: Receipt, label: 'Invoice', className: UNIFIED_PILL };
  }
  
  // Marketing
  if (lower.includes('marketing') || lower.includes('newsletter') || lower.includes('promo')) {
    return { icon: Megaphone, label: 'Marketing', className: UNIFIED_PILL };
  }
  
  // Customer requests - be specific
  if (lower.includes('booking') || lower.includes('appointment') || lower.includes('schedule')) {
    return { icon: MessageCircle, label: 'Booking', className: UNIFIED_PILL };
  }
  if (lower.includes('quote') || lower.includes('estimate') || lower.includes('pricing')) {
    return { icon: Receipt, label: 'Quote', className: UNIFIED_PILL };
  }
  if (lower.includes('cancel')) {
    return { icon: AlertTriangle, label: 'Cancel', className: UNIFIED_PILL };
  }
  if (lower.includes('reschedule') || lower.includes('rebook') || lower.includes('change date')) {
    return { icon: MessageCircle, label: 'Reschedule', className: UNIFIED_PILL };
  }
  
  // General enquiry
  if (lower.includes('enquiry') || lower.includes('inquiry') || lower.includes('question')) {
    return { icon: Mail, label: 'Enquiry', className: UNIFIED_PILL };
  }
  
  // Complaints/Issues
  if (lower.includes('complaint') || lower.includes('issue') || lower.includes('problem') || lower.includes('unhappy')) {
    return { icon: AlertTriangle, label: 'Complaint', className: UNIFIED_PILL };
  }
  
  // Feedback
  if (lower.includes('feedback') || lower.includes('review') || lower.includes('thank')) {
    return { icon: ThumbsUp, label: 'Feedback', className: UNIFIED_PILL };
  }
  
  return null;
};

// British English spelling normalisation
const toBritishLabel = (label: string): string => {
  const map: Record<string, string> = {
    'Inquiry': 'Enquiry',
    'inquiry': 'enquiry',
  };
  return map[label] || label;
};

export const getCategoryConfig = (classification: string | null | undefined): CategoryConfig | null => {
  if (!classification) return null;
  const config = categoryConfigs[classification] || getConfigByKeyword(classification);
  if (!config) return null;
  return { ...config, label: toBritishLabel(config.label) };
};

interface CategoryLabelProps {
  classification: string | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
  editable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export const CategoryLabel = ({ 
  classification, 
  size = 'sm', 
  showIcon = true,
  className,
  editable = false,
  onClick
}: CategoryLabelProps) => {
  const config = getCategoryConfig(classification);
  if (!config) return null;

  const Icon = config.icon;
  
  const sizeClasses = {
    xs: 'text-[10px] px-1.5 py-0.5',
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  };

  const iconSizes = {
    xs: 'h-2.5 w-2.5',
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
  };

  const handleClick = (e: React.MouseEvent) => {
    if (editable && onClick) {
      e.stopPropagation();
      onClick(e);
    }
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "rounded-full border flex items-center gap-1 font-medium flex-shrink-0 whitespace-nowrap",
        sizeClasses[size],
        config.className,
        editable && "cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all group",
        className
      )}
      onClick={handleClick}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {config.label}
      {editable && (
        <Pencil className={cn(
          iconSizes[size], 
          "ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        )} />
      )}
    </Badge>
  );
};
