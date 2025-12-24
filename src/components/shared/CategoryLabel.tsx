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
  // Customer categories - be specific!
  customer_inquiry: { icon: Mail, label: 'Inquiry', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  customer_complaint: { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  customer_feedback: { icon: ThumbsUp, label: 'Feedback', className: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' },
  complaint_dispute: { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  
  // Specific request types
  booking_request: { icon: MessageCircle, label: 'Booking', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  quote_request: { icon: Receipt, label: 'Quote', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  cancellation_request: { icon: AlertTriangle, label: 'Cancel', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  reschedule_request: { icon: MessageCircle, label: 'Reschedule', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  
  // Lead categories
  lead_new: { icon: UserPlus, label: 'New Lead', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  lead_followup: { icon: MessageCircle, label: 'Follow-up', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  
  // Financial categories
  supplier_invoice: { icon: Receipt, label: 'Invoice', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  supplier_urgent: { icon: Zap, label: 'Supplier Urgent', className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20' },
  receipt_confirmation: { icon: Receipt, label: 'Receipt', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  payment_confirmation: { icon: Receipt, label: 'Payment', className: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' },
  
  // Partner/Business
  partner_request: { icon: Users, label: 'Partner', className: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  
  // Automated/System
  automated_notification: { icon: Bot, label: 'Auto', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
  internal_system: { icon: Settings2, label: 'System', className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20' },
  informational_only: { icon: Info, label: 'Info', className: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' },
  
  // Noise categories
  spam_phishing: { icon: Ban, label: 'Spam', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  marketing_newsletter: { icon: Megaphone, label: 'Marketing', className: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' },
  recruitment_hr: { icon: Briefcase, label: 'Recruitment', className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
  misdirected: { icon: AlertTriangle, label: 'Misdirected', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
};

// Keyword-based fallback matching for non-standard classifications
const getConfigByKeyword = (classification: string): CategoryConfig | null => {
  const lower = classification.toLowerCase();
  
  // Payment/Receipt related
  if (lower.includes('payment') && (lower.includes('confirm') || lower.includes('received'))) {
    return { icon: Receipt, label: 'Payment', className: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' };
  }
  if (lower.includes('receipt') || lower.includes('stripe') || lower.includes('paypal')) {
    return { icon: Receipt, label: 'Receipt', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
  }
  
  // Invoice related
  if (lower.includes('invoice') || lower.includes('billing') || lower.includes('bill')) {
    return { icon: Receipt, label: 'Invoice', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
  }
  
  // Marketing
  if (lower.includes('marketing') || lower.includes('newsletter') || lower.includes('promo')) {
    return { icon: Megaphone, label: 'Marketing', className: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' };
  }
  
  // Customer requests - be specific
  if (lower.includes('booking') || lower.includes('appointment') || lower.includes('schedule')) {
    return { icon: MessageCircle, label: 'Booking', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' };
  }
  if (lower.includes('quote') || lower.includes('estimate') || lower.includes('pricing')) {
    return { icon: Receipt, label: 'Quote', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
  }
  if (lower.includes('cancel')) {
    return { icon: AlertTriangle, label: 'Cancel', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' };
  }
  if (lower.includes('reschedule') || lower.includes('rebook') || lower.includes('change date')) {
    return { icon: MessageCircle, label: 'Reschedule', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' };
  }
  
  // General enquiry - only if nothing more specific matches
  if (lower.includes('enquiry') || lower.includes('inquiry') || lower.includes('question')) {
    return { icon: Mail, label: 'Enquiry', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' };
  }
  
  // Complaints/Issues
  if (lower.includes('complaint') || lower.includes('issue') || lower.includes('problem') || lower.includes('unhappy')) {
    return { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' };
  }
  
  // Feedback
  if (lower.includes('feedback') || lower.includes('review') || lower.includes('thank')) {
    return { icon: ThumbsUp, label: 'Feedback', className: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' };
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
        "rounded-full border flex items-center gap-1 font-medium",
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
