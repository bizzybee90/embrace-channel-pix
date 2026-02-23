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

const categoryConfigs: Record<string, CategoryConfig> = {
  // Customer categories
  customer_inquiry: { icon: Mail, label: 'Inquiry', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  customer_complaint: { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-50 text-red-700 border border-red-200' },
  customer_feedback: { icon: ThumbsUp, label: 'Feedback', className: 'bg-green-50 text-green-700 border border-green-200' },
  complaint_dispute: { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-50 text-red-700 border border-red-200' },

  // Specific request types
  booking_request: { icon: MessageCircle, label: 'Booking', className: 'bg-green-50 text-green-700 border border-green-200' },
  quote_request: { icon: Receipt, label: 'Quote', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  cancellation_request: { icon: AlertTriangle, label: 'Cancel', className: 'bg-red-50 text-red-700 border border-red-200' },
  reschedule_request: { icon: MessageCircle, label: 'Reschedule', className: 'bg-amber-50 text-amber-700 border border-amber-200' },

  // Lead categories
  lead_new: { icon: UserPlus, label: 'New Lead', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  lead_followup: { icon: MessageCircle, label: 'Follow-up', className: 'bg-amber-50 text-amber-700 border border-amber-200' },

  // Financial categories
  supplier_invoice: { icon: Receipt, label: 'Invoice', className: 'bg-green-50 text-green-700 border border-green-200' },
  supplier_urgent: { icon: Zap, label: 'Supplier Urgent', className: 'bg-red-50 text-red-700 border border-red-200' },
  receipt_confirmation: { icon: Receipt, label: 'Receipt', className: 'bg-green-50 text-green-700 border border-green-200' },
  payment_confirmation: { icon: Receipt, label: 'Payment', className: 'bg-green-50 text-green-700 border border-green-200' },

  // Partner/Business
  partner_request: { icon: Users, label: 'Partner', className: 'bg-purple-50 text-purple-700 border border-purple-200' },

  // Automated/System
  automated_notification: { icon: Bot, label: 'Auto', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  internal_system: { icon: Settings2, label: 'System', className: 'bg-slate-50 text-slate-700 border border-slate-200' },
  informational_only: { icon: Info, label: 'Info', className: 'bg-blue-50 text-blue-700 border border-blue-200' },

  // Noise categories
  spam_phishing: { icon: Ban, label: 'Spam', className: 'bg-red-50 text-red-700 border border-red-200' },
  marketing_newsletter: { icon: Megaphone, label: 'Marketing', className: 'bg-green-50 text-green-700 border border-green-200' },
  recruitment_hr: { icon: Briefcase, label: 'Recruitment', className: 'bg-purple-50 text-purple-700 border border-purple-200' },
  misdirected: { icon: AlertTriangle, label: 'Misdirected', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
};

// Keyword-based fallback matching for non-standard classifications
const getConfigByKeyword = (classification: string): CategoryConfig | null => {
  const lower = classification.toLowerCase();
  
  // Payment/Receipt related
  if (lower.includes('payment') && (lower.includes('confirm') || lower.includes('received'))) {
    return { icon: Receipt, label: 'Payment', className: 'bg-green-50 text-green-700 border border-green-200' };
  }
  if (lower.includes('receipt') || lower.includes('stripe') || lower.includes('paypal')) {
    return { icon: Receipt, label: 'Receipt', className: 'bg-green-50 text-green-700 border border-green-200' };
  }

  // Invoice related
  if (lower.includes('invoice') || lower.includes('billing') || lower.includes('bill')) {
    return { icon: Receipt, label: 'Invoice', className: 'bg-green-50 text-green-700 border border-green-200' };
  }

  // Marketing
  if (lower.includes('marketing') || lower.includes('newsletter') || lower.includes('promo')) {
    return { icon: Megaphone, label: 'Marketing', className: 'bg-green-50 text-green-700 border border-green-200' };
  }

  // Customer requests - be specific
  if (lower.includes('booking') || lower.includes('appointment') || lower.includes('schedule')) {
    return { icon: MessageCircle, label: 'Booking', className: 'bg-green-50 text-green-700 border border-green-200' };
  }
  if (lower.includes('quote') || lower.includes('estimate') || lower.includes('pricing')) {
    return { icon: Receipt, label: 'Quote', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }
  if (lower.includes('cancel')) {
    return { icon: AlertTriangle, label: 'Cancel', className: 'bg-red-50 text-red-700 border border-red-200' };
  }
  if (lower.includes('reschedule') || lower.includes('rebook') || lower.includes('change date')) {
    return { icon: MessageCircle, label: 'Reschedule', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }

  // General enquiry - only if nothing more specific matches
  if (lower.includes('enquiry') || lower.includes('inquiry') || lower.includes('question')) {
    return { icon: Mail, label: 'Enquiry', className: 'bg-blue-50 text-blue-700 border border-blue-200' };
  }

  // Complaints/Issues
  if (lower.includes('complaint') || lower.includes('issue') || lower.includes('problem') || lower.includes('unhappy')) {
    return { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-50 text-red-700 border border-red-200' };
  }

  // Feedback
  if (lower.includes('feedback') || lower.includes('review') || lower.includes('thank')) {
    return { icon: ThumbsUp, label: 'Feedback', className: 'bg-green-50 text-green-700 border border-green-200' };
  }
  
  return null;
};

export const getCategoryConfig = (classification: string | null | undefined): CategoryConfig | null => {
  if (!classification) return null;
  return categoryConfigs[classification] || getConfigByKeyword(classification);
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
        "rounded-md flex items-center gap-1 font-medium tracking-wide uppercase",
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
