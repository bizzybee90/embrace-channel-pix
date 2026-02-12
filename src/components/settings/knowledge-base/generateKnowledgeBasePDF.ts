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

// ── BizzyBee Brand Palette (warm amber / honey bee) ──
const B = {
  // Core bee colours
  honey:      [245, 166, 35]  as [number, number, number],   // #F5A623  – primary amber
  honeyDark:  [212, 136, 18]  as [number, number, number],   // #D48812
  honeyLight: [255, 214, 102] as [number, number, number],   // #FFD666
  honeyCream: [255, 248, 230] as [number, number, number],   // #FFF8E6

  // Neutrals
  charcoal:   [38, 38, 38]    as [number, number, number],   // #262626
  slate:      [68, 68, 68]    as [number, number, number],   // #444444
  grey:       [120, 120, 120] as [number, number, number],   // #787878
  lightGrey:  [245, 245, 240] as [number, number, number],   // #F5F5F0
  offWhite:   [252, 250, 245] as [number, number, number],   // #FCFAF5
  white:      [255, 255, 255] as [number, number, number],

  // Accents
  teal:       [20, 184, 166]  as [number, number, number],   // #14B8A6
  coral:      [251, 113, 91]  as [number, number, number],   // #FB715B
  sky:        [56, 189, 248]  as [number, number, number],   // #38BDF8
  violet:     [139, 92, 246]  as [number, number, number],   // #8B5CF6
  rose:       [244, 63, 94]   as [number, number, number],   // #F43F5E
  emerald:    [16, 185, 129]  as [number, number, number],   // #10B981
};

const CAT_COLOURS: Record<string, [number, number, number]> = {
  services: B.honey,
  pricing:  B.emerald,
  booking:  B.violet,
  policies: B.coral,
  coverage: B.sky,
  process:  B.honeyDark,
  trust:    B.rose,
  contact:  B.teal,
};

function catColour(cat: string): [number, number, number] {
  const k = cat.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, col] of Object.entries(CAT_COLOURS)) {
    if (k.includes(key)) return col;
  }
  return B.honey;
}

export async function generateKnowledgeBasePDF(workspaceId: string, companyName?: string): Promise<void> {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mx = 16;                // side margin
  const cw = pw - mx * 2;      // content width
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
  const hLine = (x1: number, ly: number, x2: number, col: [number, number, number], w = 0.4) => {
    doc.setDrawColor(...col); doc.setLineWidth(w); doc.line(x1, ly, x2, ly);
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
  //  COVER PAGE
  // ════════════════════════════════════════

  // Warm honey gradient background
  doc.setFillColor(...B.charcoal);
  doc.rect(0, 0, pw, ph, 'F');

  // Decorative honeycomb-inspired top stripe
  doc.setFillColor(...B.honey);
  doc.rect(0, 0, pw, 5, 'F');
  // Secondary thin stripe
  doc.setFillColor(...B.honeyDark);
  doc.rect(0, 5, pw, 1.5, 'F');

  // Subtle warm glow behind logo area
  doc.setFillColor(60, 50, 30);
  doc.roundedRect(pw / 2 - 32, 48, 64, 64, 32, 32, 'F');

  // Logo
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      img.onload = () => { doc.addImage(img, 'PNG', pw / 2 - 22, 56, 44, 44); resolve(); };
      img.onerror = () => resolve();
      img.src = bizzybeeLogoSrc;
    });
  } catch { /* skip */ }

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...B.honeyLight);
  doc.text('Knowledge Base', pw / 2, 122, { align: 'center' });

  // Decorative divider
  const divW = 40;
  doc.setFillColor(...B.honey);
  doc.roundedRect(pw / 2 - divW / 2, 128, divW, 2, 1, 1, 'F');

  // Company name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...B.honey);
  doc.text(`Prepared for ${companyName || 'Your Business'}`, pw / 2, 140, { align: 'center' });

  // Date
  doc.setFontSize(10);
  doc.setTextColor(...B.grey);
  doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), pw / 2, 150, { align: 'center' });

  // ── Stats cards ──
  const sY = 170;
  const cardW = 44;
  const gap = 10;
  const totalW = cardW * 3 + gap * 2;
  const sX = (pw - totalW) / 2;
  const stats = [
    { label: 'FAQs', value: String(faqs.length), accent: B.honey },
    { label: 'Categories', value: String(catOrder.length), accent: B.teal },
    { label: 'Pages Scraped', value: String(scrapingJob?.pages_processed || 0), accent: B.emerald },
  ];

  stats.forEach((s, i) => {
    const cx = sX + i * (cardW + gap);
    // Card bg
    rRect(cx, sY, cardW, 38, 5, [50, 48, 42]);
    // Top accent bar
    doc.setFillColor(...s.accent);
    doc.roundedRect(cx, sY, cardW, 4, 5, 5, 'F');
    doc.setFillColor(50, 48, 42);
    doc.rect(cx, sY + 3, cardW, 3, 'F');
    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(...B.white);
    doc.text(s.value, cx + cardW / 2, sY + 22, { align: 'center' });
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...B.grey);
    doc.text(s.label, cx + cardW / 2, sY + 31, { align: 'center' });
  });

  // Website URL
  if (scrapingJob?.website_url) {
    doc.setFontSize(9);
    doc.setTextColor(...B.grey);
    doc.text(scrapingJob.website_url, pw / 2, ph - 32, { align: 'center' });
  }

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 90);
  doc.text('Powered by BizzyBee AI  🐝', pw / 2, ph - 16, { align: 'center' });

  // ════════════════════════════════════════
  //  PAGE HEADER
  // ════════════════════════════════════════
  const pageHeader = () => {
    // Warm top bar
    doc.setFillColor(...B.honeyCream);
    doc.rect(0, 0, pw, 13, 'F');
    doc.setFillColor(...B.honey);
    doc.rect(0, 12.5, pw, 0.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...B.honeyDark);
    doc.text('🐝  BizzyBee Knowledge Base', mx, 8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...B.grey);
    doc.text(companyName || '', pw - mx, 8.5, { align: 'right' });
    y = 20;
  };

  // ── section title ──
  const sectionTitle = (text: string, colour: [number, number, number] = B.honey) => {
    ensureSpace(18);
    doc.setFillColor(...colour);
    doc.roundedRect(mx, y, 3, 13, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...B.charcoal);
    doc.text(text, mx + 8, y + 10);
    y += 18;
  };

  // ════════════════════════════════════════
  //  SCRAPING SUMMARY
  // ════════════════════════════════════════
  doc.addPage();
  pageHeader();

  if (scrapingJob) {
    sectionTitle('Website Analysis Summary');
    rRect(mx, y, cw, 44, 5, B.honeyCream);
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
      doc.setTextColor(...B.grey);
      doc.text(label.toUpperCase(), mx + 8, iy);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.setTextColor(...B.charcoal);
      doc.text(value, mx + 55, iy);
      iy += 9;
    });
    y += 52;
  }

  // ════════════════════════════════════════
  //  CATEGORY OVERVIEW
  // ════════════════════════════════════════
  sectionTitle('Category Overview', B.teal);

  catOrder.forEach(([cat, items]) => {
    ensureSpace(11);
    const col = catColour(cat);
    doc.setFillColor(...col);
    doc.roundedRect(mx + 4, y - 2.5, 3, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.setTextColor(...B.charcoal);
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
    doc.text(label, mx + 11, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(...B.grey);
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

    // Category header band
    rRect(mx, y, cw, 16, 5, col);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.setTextColor(...B.white);
    doc.text(label, mx + 8, y + 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`${items.length} questions`, pw - mx - 8, y + 11, { align: 'right' });
    y += 22;

    items.forEach((faq, idx) => {
      const qLines = doc.splitTextToSize(faq.question, cw - 26);
      const aLines = doc.splitTextToSize(faq.answer, cw - 26);
      const itemH = (qLines.length + aLines.length) * 5 + 16;

      ensureSpace(itemH + 4);
      if (y < 20) pageHeader();

      // Alternating warm background
      if (idx % 2 === 0) {
        rRect(mx, y - 2, cw, itemH, 4, B.honeyCream);
      }

      // Question number badge
      doc.setFillColor(...col);
      doc.roundedRect(mx + 4, y + 1, 14, 6, 2, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(...B.white);
      doc.text(`Q${idx + 1}`, mx + 11, y + 5.5, { align: 'center' });

      // Question
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.setTextColor(...B.charcoal);
      doc.text(qLines, mx + 22, y + 6);
      y += qLines.length * 5 + 6;

      // Answer
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      doc.setTextColor(...B.slate);
      doc.text(aLines, mx + 22, y);
      y += aLines.length * 5 + 8;
    });
  });

  // ════════════════════════════════════════
  //  BUSINESS FACTS
  // ════════════════════════════════════════
  if (facts.length > 0) {
    doc.addPage();
    pageHeader();
    sectionTitle('Business Facts', B.emerald);

    Object.entries(factsByCat).forEach(([cat, items]) => {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.setTextColor(...B.charcoal);
      doc.text(cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '), mx + 4, y + 4);
      y += 10;

      items.forEach(f => {
        ensureSpace(12);
        doc.setFillColor(...B.honey);
        doc.circle(mx + 6, y + 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.setTextColor(...B.slate);
        const keyText = f.fact_key.replace(/_/g, ' ');
        doc.text(keyText, mx + 11, y + 3);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...B.grey);
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
    hLine(mx, ph - 16, pw - mx, [230, 220, 200], 0.3);
    doc.setFontSize(7);
    doc.setTextColor(...B.grey);
    doc.text('Generated by BizzyBee AI  🐝', mx, ph - 10);
    doc.setTextColor(...B.honeyDark);
    doc.text(`Page ${i - 1} of ${pc - 1}`, pw - mx, ph - 10, { align: 'right' });
  }

  doc.save(`BizzyBee-Knowledge-Base-${new Date().toISOString().split('T')[0]}.pdf`);
}
