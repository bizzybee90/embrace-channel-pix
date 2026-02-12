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

// ── BizzyBee Design System (matches app's index.css) ──
const C = {
  // Primary blue (--primary: 217 91% 60%)
  primary:      [59, 130, 246]  as [number, number, number],   // hsl(217,91%,60%) ≈ #3B82F6
  primaryDark:  [37, 99, 235]   as [number, number, number],   // slightly darker
  primaryLight: [147, 187, 253] as [number, number, number],   // light tint
  primaryPale:  [235, 242, 254] as [number, number, number],   // very light bg

  // Backgrounds (--background: 220 17% 97%)
  background:   [245, 247, 250] as [number, number, number],   // #F5F7FA
  white:        [255, 255, 255] as [number, number, number],
  
  // Text (--foreground: 220 15% 12%)
  foreground:   [26, 28, 34]    as [number, number, number],   // #1A1C22
  muted:        [107, 114, 128] as [number, number, number],   // muted-foreground
  subtle:       [156, 163, 175] as [number, number, number],   // lighter muted

  // Borders
  border:       [229, 231, 235] as [number, number, number],   // #E5E7EB

  // Category accents
  blue:         [59, 130, 246]  as [number, number, number],
  emerald:      [16, 185, 129]  as [number, number, number],   // --success
  amber:        [245, 158, 11]  as [number, number, number],   // --warning
  violet:       [139, 92, 246]  as [number, number, number],
  rose:         [244, 63, 94]   as [number, number, number],   // --destructive
  teal:         [20, 184, 166]  as [number, number, number],
  orange:       [249, 115, 22]  as [number, number, number],   // --urgent
  sky:          [56, 189, 248]  as [number, number, number],
};

const CAT_COLOURS: Record<string, [number, number, number]> = {
  services: C.primary,
  pricing:  C.emerald,
  booking:  C.violet,
  policies: C.rose,
  coverage: C.sky,
  process:  C.amber,
  trust:    C.teal,
  contact:  C.orange,
};

function catColour(cat: string): [number, number, number] {
  const k = cat.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, col] of Object.entries(CAT_COLOURS)) {
    if (k.includes(key)) return col;
  }
  return C.primary;
}

export async function generateKnowledgeBasePDF(workspaceId: string, companyName?: string): Promise<void> {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mx = 18;
  const cw = pw - mx * 2;
  let y = mx;

  const sb: any = supabase as any;

  // ── paginated fetch ──
  const fetchAll = async <T,>(table: string, select: string, build?: (q: any) => any): Promise<T[]> => {
    const ps = 1000; let from = 0; const rows: T[] = [];
    while (true) {
      let q = sb.from(table).select(select).eq('workspace_id', workspaceId).range(from, from + ps - 1);
      if (build) q = build(q);
      const { data, error } = await q;
      if (error) throw error;
      const page = (data || []) as T[];
      rows.push(...page);
      if (page.length < ps) break;
      from += ps;
    }
    return rows;
  };

  // ── helpers ──
  const ensureSpace = (n: number) => { if (y + n > ph - 22) { doc.addPage(); y = mx + 4; } };
  const rRect = (x: number, ry: number, w: number, h: number, r: number, fill: [number, number, number]) => {
    doc.setFillColor(...fill); doc.roundedRect(x, ry, w, h, r, r, 'F');
  };
  const hLine = (ly: number, col: [number, number, number] = C.border, w = 0.3) => {
    doc.setDrawColor(...col); doc.setLineWidth(w); doc.line(mx, ly, pw - mx, ly);
  };

  // ── fetch data ──
  const [faqs, facts, scrapingJob] = await Promise.all([
    fetchAll<FAQItem>('faq_database', 'question, answer, category, priority, is_own_content, source_type', q =>
      q.eq('is_active', true).eq('is_own_content', true).order('priority', { ascending: false })
    ),
    fetchAll<BusinessFact>('business_facts', 'fact_key, fact_value, category'),
    sb.from('scraping_jobs')
      .select('website_url, total_pages_found, pages_processed, faqs_found, completed_at')
      .eq('workspace_id', workspaceId).eq('status', 'completed')
      .order('completed_at', { ascending: false }).limit(1).maybeSingle()
      .then((r: any) => r.data),
  ]);

  // group
  const faqsByCat: Record<string, FAQItem[]> = {};
  faqs.forEach(f => { const c = f.category || 'General'; (faqsByCat[c] ??= []).push(f); });
  const catOrder = Object.entries(faqsByCat).sort((a, b) => b[1].length - a[1].length);

  const factsByCat: Record<string, BusinessFact[]> = {};
  facts.forEach(f => { (factsByCat[f.category] ??= []).push(f); });

  // ════════════════════════════════════════
  //  COVER PAGE — Clean, light, modern
  // ════════════════════════════════════════

  // White background (default)
  doc.setFillColor(...C.white);
  doc.rect(0, 0, pw, ph, 'F');

  // Top accent bar — primary blue
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pw, 4, 'F');

  // Logo
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      img.onload = () => { doc.addImage(img, 'PNG', pw / 2 - 20, 50, 40, 40); resolve(); };
      img.onerror = () => resolve();
      img.src = bizzybeeLogoSrc;
    });
  } catch { /* skip */ }

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...C.foreground);
  doc.text('Knowledge Base', pw / 2, 110, { align: 'center' });

  // Subtle divider
  doc.setFillColor(...C.primary);
  doc.roundedRect(pw / 2 - 20, 116, 40, 2, 1, 1, 'F');

  // Company name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...C.muted);
  doc.text(`Prepared for ${companyName || 'Your Business'}`, pw / 2, 128, { align: 'center' });

  // Date
  doc.setFontSize(10);
  doc.setTextColor(...C.subtle);
  doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), pw / 2, 138, { align: 'center' });

  // ── Stats cards — light cards with blue accent ──
  const sY = 160;
  const cardW = 48;
  const gap = 8;
  const totalW = cardW * 3 + gap * 2;
  const sX = (pw - totalW) / 2;
  const stats = [
    { label: 'FAQs', value: String(faqs.length), accent: C.primary },
    { label: 'Categories', value: String(catOrder.length), accent: C.emerald },
    { label: 'Pages Scraped', value: String(scrapingJob?.pages_processed || 0), accent: C.amber },
  ];

  stats.forEach((s, i) => {
    const cx = sX + i * (cardW + gap);
    // Card background
    rRect(cx, sY, cardW, 42, 4, C.background);
    // Top accent line
    doc.setFillColor(...s.accent);
    doc.roundedRect(cx + 8, sY + 2, cardW - 16, 2, 1, 1, 'F');
    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(...C.foreground);
    doc.text(s.value, cx + cardW / 2, sY + 24, { align: 'center' });
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(s.label, cx + cardW / 2, sY + 34, { align: 'center' });
  });

  // Website URL
  if (scrapingJob?.website_url) {
    doc.setFontSize(9);
    doc.setTextColor(...C.subtle);
    doc.text(scrapingJob.website_url, pw / 2, ph - 32, { align: 'center' });
  }

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(...C.subtle);
  doc.text('Powered by BizzyBee AI', pw / 2, ph - 16, { align: 'center' });

  // ════════════════════════════════════════
  //  PAGE HEADER — light bar with blue accent
  // ════════════════════════════════════════
  const pageHeader = () => {
    doc.setFillColor(...C.white);
    doc.rect(0, 0, pw, 14, 'F');
    doc.setFillColor(...C.primary);
    doc.rect(0, 13, pw, 0.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...C.primary);
    doc.text('BizzyBee Knowledge Base', mx, 9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.muted);
    doc.text(companyName || '', pw - mx, 9, { align: 'right' });
    y = 22;
  };

  // ── section title ──
  const sectionTitle = (text: string, colour: [number, number, number] = C.primary) => {
    ensureSpace(18);
    doc.setFillColor(...colour);
    doc.roundedRect(mx, y, 3, 12, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...C.foreground);
    doc.text(text, mx + 8, y + 9);
    y += 16;
  };

  // ════════════════════════════════════════
  //  SCRAPING SUMMARY
  // ════════════════════════════════════════
  doc.addPage();
  pageHeader();

  if (scrapingJob) {
    sectionTitle('Website Analysis Summary');
    rRect(mx, y, cw, 44, 4, C.primaryPale);
    doc.setFontSize(10);
    const info = [
      ['Website', scrapingJob.website_url || 'N/A'],
      ['Pages Discovered', String(scrapingJob.total_pages_found || 0)],
      ['Pages Processed', String(scrapingJob.pages_processed || 0)],
      ['FAQs Extracted', String(scrapingJob.faqs_found || 0)],
    ];
    let iy = y + 10;
    info.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      doc.text(label.toUpperCase(), mx + 8, iy);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.setTextColor(...C.foreground);
      doc.text(value, mx + 55, iy);
      iy += 9;
    });
    y += 52;
  }

  // ════════════════════════════════════════
  //  CATEGORY OVERVIEW
  // ════════════════════════════════════════
  sectionTitle('Category Overview', C.emerald);

  catOrder.forEach(([cat, items]) => {
    ensureSpace(11);
    const col = catColour(cat);
    doc.setFillColor(...col);
    doc.roundedRect(mx + 4, y - 2.5, 3, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.setTextColor(...C.foreground);
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
    doc.text(label, mx + 11, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(`${items.length} FAQs`, mx + 11 + doc.getTextWidth(label) + 4, y + 3);
    y += 10;
  });
  y += 6;

  // ════════════════════════════════════════
  //  FAQ SECTIONS
  // ════════════════════════════════════════
  catOrder.forEach(([cat, items]) => {
    doc.addPage();
    pageHeader();

    const col = catColour(cat);
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');

    // Category header — clean pill
    rRect(mx, y, cw, 14, 4, col);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(...C.white);
    doc.text(label, mx + 8, y + 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`${items.length} questions`, pw - mx - 8, y + 10, { align: 'right' });
    y += 20;

    items.forEach((faq, idx) => {
      const qLines = doc.splitTextToSize(faq.question, cw - 24);
      const aLines = doc.splitTextToSize(faq.answer, cw - 24);
      const itemH = (qLines.length + aLines.length) * 5 + 14;

      ensureSpace(itemH + 4);
      if (y < 22) pageHeader();

      // Alternating subtle background
      if (idx % 2 === 0) {
        rRect(mx, y - 2, cw, itemH, 3, C.background);
      }

      // Question number badge
      doc.setFillColor(...col);
      doc.roundedRect(mx + 4, y + 1, 13, 6, 2, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(...C.white);
      doc.text(`Q${idx + 1}`, mx + 10.5, y + 5.5, { align: 'center' });

      // Question
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.setTextColor(...C.foreground);
      doc.text(qLines, mx + 20, y + 6);
      y += qLines.length * 5 + 6;

      // Answer
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      doc.setTextColor(...C.muted);
      doc.text(aLines, mx + 20, y);
      y += aLines.length * 5 + 8;
    });
  });

  // ════════════════════════════════════════
  //  BUSINESS FACTS
  // ════════════════════════════════════════
  if (facts.length > 0) {
    doc.addPage();
    pageHeader();
    sectionTitle('Business Facts', C.emerald);

    Object.entries(factsByCat).forEach(([cat, items]) => {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.setTextColor(...C.foreground);
      doc.text(cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '), mx + 4, y + 4);
      y += 10;

      items.forEach(f => {
        ensureSpace(12);
        doc.setFillColor(...C.primary);
        doc.circle(mx + 6, y + 1.5, 1.2, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.setTextColor(...C.foreground);
        const keyText = f.fact_key.replace(/_/g, ' ');
        doc.text(keyText, mx + 11, y + 3);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.muted);
        const valLines = doc.splitTextToSize(f.fact_value, cw - 15 - doc.getTextWidth(keyText) - 6);
        if (valLines.length === 1) {
          doc.text(`: ${f.fact_value}`, mx + 11 + doc.getTextWidth(keyText), y + 3);
          y += 7;
        } else {
          y += 5;
          const fullLines = doc.splitTextToSize(f.fact_value, cw - 15);
          doc.text(fullLines, mx + 11, y);
          y += fullLines.length * 4.5 + 3;
        }
      });
      y += 6;
    });
  }

  // ════════════════════════════════════════
  //  FOOTERS
  // ════════════════════════════════════════
  const pc = doc.getNumberOfPages();
  for (let i = 2; i <= pc; i++) {
    doc.setPage(i);
    hLine(ph - 16);
    doc.setFontSize(7);
    doc.setTextColor(...C.subtle);
    doc.text('Generated by BizzyBee AI', mx, ph - 10);
    doc.setTextColor(...C.primary);
    doc.text(`Page ${i - 1} of ${pc - 1}`, pw - mx, ph - 10, { align: 'right' });
  }

  doc.save(`BizzyBee-Knowledge-Base-${new Date().toISOString().split('T')[0]}.pdf`);
}
