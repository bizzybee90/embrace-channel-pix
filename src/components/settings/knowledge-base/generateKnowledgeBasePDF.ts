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

// BizzyBee brand colours
const BRAND = {
  primary: [59, 130, 246] as [number, number, number],       // #3B82F6
  primaryDark: [37, 99, 235] as [number, number, number],    // #2563EB
  dark: [30, 41, 59] as [number, number, number],            // #1E293B
  text: [51, 65, 85] as [number, number, number],            // #334155
  textLight: [100, 116, 139] as [number, number, number],    // #64748B
  surface: [248, 250, 252] as [number, number, number],      // #F8FAFC
  surfaceAlt: [241, 245, 249] as [number, number, number],   // #F1F5F9
  white: [255, 255, 255] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],         // #F59E0B
  green: [34, 197, 94] as [number, number, number],          // #22C55E
  border: [226, 232, 240] as [number, number, number],       // #E2E8F0
};

const CATEGORY_COLOURS: Record<string, [number, number, number]> = {
  services: [59, 130, 246],
  pricing: [34, 197, 94],
  booking: [168, 85, 247],
  policies: [239, 68, 68],
  coverage: [14, 165, 233],
  process: [245, 158, 11],
  trust: [236, 72, 153],
  contact: [99, 102, 241],
};

function getCategoryColour(cat: string): [number, number, number] {
  const key = cat.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(CATEGORY_COLOURS)) {
    if (key.includes(k)) return v;
  }
  return BRAND.primary;
}

export async function generateKnowledgeBasePDF(workspaceId: string, companyName?: string): Promise<void> {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 18;
  const cw = pw - margin * 2;
  let y = margin;

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

  // ---------- helpers ----------
  const ensureSpace = (needed: number) => {
    if (y + needed > ph - 24) {
      doc.addPage();
      y = margin + 4;
    }
  };

  const drawRoundedRect = (x: number, ry: number, w: number, h: number, r: number, fill: [number, number, number]) => {
    doc.setFillColor(...fill);
    doc.roundedRect(x, ry, w, h, r, r, 'F');
  };

  const drawLine = (x1: number, y1: number, x2: number, colour: [number, number, number], width = 0.5) => {
    doc.setDrawColor(...colour);
    doc.setLineWidth(width);
    doc.line(x1, y1, x2, y1);
  };

  // ---------- fetch data ----------
  const [faqs, facts, scrapingJob] = await Promise.all([
    fetchAll<FAQItem>('faq_database', 'question, answer, category, priority, is_own_content, source_type', q =>
      q.eq('is_active', true).eq('is_own_content', true).order('priority', { ascending: false })
    ),
    fetchAll<BusinessFact>('business_facts', 'fact_key, fact_value, category'),
    sb.from('scraping_jobs')
      .select('website_url, total_pages_found, pages_processed, faqs_found, completed_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r: any) => r.data),
  ]);

  // Group FAQs
  const faqsByCategory: Record<string, FAQItem[]> = {};
  faqs.forEach(faq => {
    const cat = faq.category || 'General';
    if (!faqsByCategory[cat]) faqsByCategory[cat] = [];
    faqsByCategory[cat].push(faq);
  });
  const categoryOrder = Object.entries(faqsByCategory).sort((a, b) => b[1].length - a[1].length);

  // Group facts
  const factsByCategory: Record<string, BusinessFact[]> = {};
  facts.forEach(f => {
    if (!factsByCategory[f.category]) factsByCategory[f.category] = [];
    factsByCategory[f.category].push(f);
  });

  // ===================================================
  //  COVER PAGE
  // ===================================================
  // Full-page dark background
  doc.setFillColor(...BRAND.dark);
  doc.rect(0, 0, pw, ph, 'F');

  // Accent stripe at top
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, pw, 6, 'F');

  // BizzyBee logo
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      img.onload = () => {
        doc.addImage(img, 'PNG', pw / 2 - 20, 60, 40, 40);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = bizzybeeLogoSrc;
    });
  } catch { /* skip */ }

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(...BRAND.white);
  doc.text('Knowledge Base', pw / 2, 120, { align: 'center' });

  // Subtitle
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...BRAND.primary);
  doc.text(`Prepared for ${companyName || 'Your Business'}`, pw / 2, 132, { align: 'center' });

  // Date
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.textLight);
  doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), pw / 2, 142, { align: 'center' });

  // Stats cards row
  const statsY = 165;
  const cardW = 42;
  const gap = 8;
  const totalCardsW = cardW * 3 + gap * 2;
  const startX = (pw - totalCardsW) / 2;

  const statsData = [
    { label: 'FAQs', value: String(faqs.length), colour: BRAND.primary },
    { label: 'Categories', value: String(categoryOrder.length), colour: BRAND.amber },
    { label: 'Pages Scraped', value: String(scrapingJob?.pages_processed || 0), colour: BRAND.green },
  ];

  statsData.forEach((stat, i) => {
    const cx = startX + i * (cardW + gap);
    // Card background
    drawRoundedRect(cx, statsY, cardW, 36, 4, [41, 55, 78]);
    // Accent top bar
    doc.setFillColor(...stat.colour);
    doc.roundedRect(cx, statsY, cardW, 4, 4, 4, 'F');
    doc.setFillColor(41, 55, 78);
    doc.rect(cx, statsY + 3, cardW, 3, 'F');
    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...BRAND.white);
    doc.text(stat.value, cx + cardW / 2, statsY + 20, { align: 'center' });
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.textLight);
    doc.text(stat.label, cx + cardW / 2, statsY + 29, { align: 'center' });
  });

  // Website URL at bottom
  if (scrapingJob?.website_url) {
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.textLight);
    doc.text(scrapingJob.website_url, pw / 2, ph - 30, { align: 'center' });
  }

  // Powered by line
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Powered by BizzyBee AI', pw / 2, ph - 18, { align: 'center' });

  // ===================================================
  //  PAGE HEADER HELPER (for subsequent pages)
  // ===================================================
  const addPageHeader = () => {
    // Subtle top bar
    doc.setFillColor(...BRAND.surface);
    doc.rect(0, 0, pw, 14, 'F');
    drawLine(0, 14, pw, BRAND.border, 0.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.textLight);
    doc.text('BizzyBee Knowledge Base', margin, 9);
    doc.text(companyName || '', pw - margin, 9, { align: 'right' });
    y = 22;
  };

  // ===================================================
  //  SCRAPING SUMMARY PAGE
  // ===================================================
  doc.addPage();
  addPageHeader();

  // Section title
  const sectionTitle = (text: string, colour: [number, number, number] = BRAND.primary) => {
    ensureSpace(18);
    doc.setFillColor(...colour);
    doc.roundedRect(margin, y, 3, 12, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...BRAND.dark);
    doc.text(text, margin + 8, y + 9);
    y += 18;
  };

  if (scrapingJob) {
    sectionTitle('Website Analysis Summary');
    
    // Info card
    drawRoundedRect(margin, y, cw, 42, 4, BRAND.surfaceAlt);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.text);
    
    const infoItems = [
      ['Website', scrapingJob.website_url || 'N/A'],
      ['Pages Discovered', String(scrapingJob.total_pages_found || 0)],
      ['Pages Processed', String(scrapingJob.pages_processed || 0)],
      ['FAQs Extracted', String(scrapingJob.faqs_found || 0)],
    ];
    
    let iy = y + 10;
    infoItems.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...BRAND.textLight);
      doc.setFontSize(8);
      doc.text(label.toUpperCase(), margin + 8, iy);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...BRAND.dark);
      doc.setFontSize(10);
      doc.text(value, margin + 55, iy);
      iy += 9;
    });
    y += 50;
  }

  // ===================================================
  //  CATEGORY OVERVIEW
  // ===================================================
  sectionTitle('Category Overview', BRAND.amber);

  categoryOrder.forEach(([cat, items]) => {
    ensureSpace(12);
    const colour = getCategoryColour(cat);
    
    // Category pill
    doc.setFillColor(...colour);
    doc.roundedRect(margin + 4, y - 3, 3, 8, 1, 1, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.dark);
    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
    doc.text(catLabel, margin + 11, y + 3);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.textLight);
    doc.text(`${items.length} FAQs`, margin + 11 + doc.getTextWidth(catLabel) + 4, y + 3);
    
    y += 10;
  });

  y += 6;

  // ===================================================
  //  FAQ SECTIONS
  // ===================================================
  categoryOrder.forEach(([cat, items]) => {
    doc.addPage();
    addPageHeader();

    const colour = getCategoryColour(cat);
    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');

    // Category header band
    drawRoundedRect(margin, y, cw, 16, 4, colour);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BRAND.white);
    doc.text(catLabel, margin + 8, y + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${items.length} questions`, pw - margin - 8, y + 11, { align: 'right' });
    y += 22;

    items.forEach((faq, idx) => {
      // Estimate height needed
      const qLines = doc.splitTextToSize(faq.question, cw - 24);
      const aLines = doc.splitTextToSize(faq.answer, cw - 24);
      const itemHeight = (qLines.length + aLines.length) * 5 + 16;
      
      ensureSpace(itemHeight + 4);
      if (y < 22) addPageHeader();

      // Alternating background
      if (idx % 2 === 0) {
        drawRoundedRect(margin, y - 2, cw, itemHeight, 3, BRAND.surfaceAlt);
      }

      // Question number badge
      doc.setFillColor(...colour);
      doc.roundedRect(margin + 4, y + 1, 14, 6, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...BRAND.white);
      doc.text(`Q${idx + 1}`, margin + 11, y + 5.5, { align: 'center' });

      // Question text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...BRAND.dark);
      doc.text(qLines, margin + 22, y + 6);
      y += qLines.length * 5 + 6;

      // Answer text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...BRAND.text);
      doc.text(aLines, margin + 22, y);
      y += aLines.length * 5 + 8;
    });
  });

  // ===================================================
  //  BUSINESS FACTS
  // ===================================================
  if (facts.length > 0) {
    doc.addPage();
    addPageHeader();
    sectionTitle('Business Facts', BRAND.green);

    Object.entries(factsByCategory).forEach(([cat, items]) => {
      ensureSpace(16);
      
      // Category label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...BRAND.dark);
      doc.text(cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '), margin + 4, y + 4);
      y += 10;

      items.forEach(f => {
        ensureSpace(12);
        doc.setFillColor(...BRAND.primary);
        doc.circle(margin + 6, y + 1.5, 1.5, 'F');
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...BRAND.text);
        const keyText = f.fact_key.replace(/_/g, ' ');
        doc.text(keyText, margin + 11, y + 3);
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...BRAND.textLight);
        const valLines = doc.splitTextToSize(f.fact_value, cw - 15 - doc.getTextWidth(keyText) - 6);
        if (valLines.length === 1) {
          doc.text(`: ${f.fact_value}`, margin + 11 + doc.getTextWidth(keyText), y + 3);
          y += 7;
        } else {
          y += 5;
          const fullLines = doc.splitTextToSize(f.fact_value, cw - 15);
          doc.text(fullLines, margin + 11, y);
          y += fullLines.length * 4.5 + 3;
        }
      });
      y += 6;
    });
  }

  // ===================================================
  //  FOOTER on all pages
  // ===================================================
  const pageCount = doc.getNumberOfPages();
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    // Bottom line
    drawLine(margin, ph - 16, pw - margin, BRAND.border, 0.3);
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.textLight);
    doc.text('Generated by BizzyBee AI', margin, ph - 10);
    doc.text(`Page ${i - 1} of ${pageCount - 1}`, pw - margin, ph - 10, { align: 'right' });
  }

  const filename = `BizzyBee-Knowledge-Base-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
