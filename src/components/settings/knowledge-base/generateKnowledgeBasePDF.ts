import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import bizzybeeLogoSrc from '@/assets/bizzybee-logo.png';

interface FAQItem {
  question: string;
  answer: string;
  category: string | null;
  priority: number | null;
  is_own_content: boolean | null;
  source_type: string | null;
}

interface BusinessFact {
  fact_key: string;
  fact_value: string;
  category: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  10: '★ Your Website',
  9: '★ Manual',
  8: '★ Document',
  5: 'Competitor',
  3: 'Template',
};

export async function generateKnowledgeBasePDF(workspaceId: string, companyName?: string): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Use `any` to avoid deep-instantiation type errors on dynamic queries
  const sb: any = supabase as any;

  const fetchAll = async <T,>(table: string, select: string, build?: (q: any) => any): Promise<T[]> => {
    const pageSize = 1000;
    let from = 0;
    const rows: T[] = [];
    while (true) {
      let q = sb.from(table).select(select).eq('workspace_id', workspaceId).range(from, from + pageSize - 1);
      if (build) q = build(q);
      const { data, error } = await q;
      if (error) throw error;
      const page = (data || []) as T[];
      rows.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  // --- Helpers ---
  const addTitle = (text: string, size = 18) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(text, margin, y);
    y += size * 0.5 + 4;
  };

  const addSubtitle = (text: string) => {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(text, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;
  };

  const addText = (text: string, indent = 0) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    doc.text(lines, margin + indent, y);
    y += lines.length * 5 + 2;
  };

  const addBullet = (text: string) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('•', margin + 5, y);
    const lines = doc.splitTextToSize(text, contentWidth - 15);
    doc.text(lines, margin + 12, y);
    y += lines.length * 5 + 2;
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const addSpacer = (h = 8) => { y += h; };

  // --- Fetch data ---
  const [faqs, facts, scrapingJob] = await Promise.all([
    fetchAll<FAQItem>('faq_database', 'question, answer, category, priority, is_own_content, source_type', q => q.eq('is_active', true).order('priority', { ascending: false })),
    fetchAll<BusinessFact>('business_facts', 'fact_key, fact_value, category'),
    sb.from('scraping_jobs').select('website_url, total_pages_found, pages_processed, faqs_found, completed_at').eq('workspace_id', workspaceId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(1).maybeSingle().then((r: any) => r.data),
  ]);

  // Group FAQs by category
  const faqsByCategory: Record<string, FAQItem[]> = {};
  faqs.forEach(faq => {
    const cat = faq.category || 'General';
    if (!faqsByCategory[cat]) faqsByCategory[cat] = [];
    faqsByCategory[cat].push(faq);
  });
  const categoryOrder = Object.entries(faqsByCategory).sort((a, b) => b[1].length - a[1].length);

  // Group facts by category
  const factsByCategory: Record<string, BusinessFact[]> = {};
  facts.forEach(f => {
    if (!factsByCategory[f.category]) factsByCategory[f.category] = [];
    factsByCategory[f.category].push(f);
  });

  // ===== HEADER with logo =====
  doc.setFillColor(245, 245, 250);
  doc.rect(0, 0, pageWidth, 50, 'F');

  // Try to add BizzyBee logo
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      img.onload = () => {
        doc.addImage(img, 'PNG', margin, 10, 12, 12);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = bizzybeeLogoSrc;
    });
  } catch { /* skip logo if it fails */ }

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('BizzyBee Knowledge Base', margin + 16, 20);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Prepared for ${companyName || 'Your Business'}`, margin + 16, 28);
  doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), pageWidth - margin - 50, 28);
  
  // Accent line
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(1.5);
  doc.line(margin, 45, pageWidth - margin, 45);
  
  doc.setTextColor(0, 0, 0);
  y = 58;

  // ===== SUMMARY =====
  addTitle('Summary', 14);
  const summaryParts: string[] = [];
  summaryParts.push(`${faqs.length} active FAQs across ${categoryOrder.length} categories.`);
  if (facts.length > 0) summaryParts.push(`${facts.length} business facts stored.`);
  if (scrapingJob) {
    summaryParts.push(`Website scraped: ${scrapingJob.website_url || 'N/A'} — ${scrapingJob.pages_processed || 0} pages processed, ${scrapingJob.faqs_found || 0} FAQs extracted.`);
  }
  addText(summaryParts.join(' '));
  addSpacer();

  // ===== WEBSITE SCRAPING SUMMARY =====
  if (scrapingJob) {
    addTitle('Website Scraping Results', 14);
    addBullet(`URL: ${scrapingJob.website_url}`);
    addBullet(`Pages discovered: ${scrapingJob.total_pages_found || 0}`);
    addBullet(`Pages processed: ${scrapingJob.pages_processed || 0}`);
    addBullet(`FAQs extracted: ${scrapingJob.faqs_found || 0}`);
    if (scrapingJob.completed_at) {
      addBullet(`Completed: ${new Date(scrapingJob.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    }
    addSpacer();
  }

  // ===== FAQ OVERVIEW =====
  addTitle('FAQ Overview by Category', 14);
  categoryOrder.forEach(([cat, items]) => {
    const ownCount = items.filter(i => i.is_own_content).length;
    const label = ownCount > 0 ? `${cat} — ${items.length} FAQs (${ownCount} from your website)` : `${cat} — ${items.length} FAQs`;
    addBullet(label);
  });
  addSpacer();

  // ===== FULL FAQ LISTING =====
  categoryOrder.forEach(([cat, items]) => {
    checkPageBreak(30);
    addTitle(cat, 13);

    items.forEach((faq, idx) => {
      checkPageBreak(35);
      const priorityLabel = PRIORITY_LABELS[faq.priority || 5] || `P${faq.priority}`;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text(`Q${idx + 1}: `, margin + 2, y);
      doc.setFont('helvetica', 'normal');
      const qLines = doc.splitTextToSize(faq.question, contentWidth - 15);
      doc.text(qLines, margin + 14, y);
      y += qLines.length * 5 + 2;

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      const aLines = doc.splitTextToSize(`A: ${faq.answer}`, contentWidth - 10);
      doc.text(aLines, margin + 5, y);
      y += aLines.length * 5 + 2;

      // Source tag
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 130);
      doc.text(`[${priorityLabel}]`, margin + 5, y);
      doc.setTextColor(0, 0, 0);
      y += 6;
    });

    addSpacer(4);
  });

  // ===== BUSINESS FACTS =====
  if (facts.length > 0) {
    checkPageBreak(30);
    addTitle('Business Facts', 14);

    Object.entries(factsByCategory).forEach(([cat, items]) => {
      checkPageBreak(20);
      addSubtitle(cat);
      items.forEach(f => {
        checkPageBreak(12);
        addBullet(`${f.fact_key}: ${f.fact_value}`);
      });
      addSpacer(4);
    });
  }

  // ===== FOOTER =====
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated by BizzyBee • Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  const filename = `BizzyBee-Knowledge-Base-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
