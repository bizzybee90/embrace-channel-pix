import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import bizzybeeLogoSrc from '@/assets/bizzybee-logo.png';

interface CompetitorFaq {
  question: string;
  answer: string;
  category: string | null;
  source_business: string | null;
  source_url: string | null;
}

interface RefinedFaq {
  question: string;
  answer: string;
  category: string | null;
  original_faq_id: string | null;
}

export async function generateCompetitorResearchPDF(workspaceId: string, companyName?: string): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
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

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Fetch competitor FAQs (is_own_content = false) and refined/adapted versions
  const [competitorFaqs, allFaqs] = await Promise.all([
    fetchAll<CompetitorFaq & { id: string }>('faq_database', 'id, question, answer, category, source_business, source_url', q =>
      q.eq('is_active', true).eq('is_own_content', false).order('category').order('source_business')
    ),
    fetchAll<RefinedFaq & { id: string }>('faq_database', 'id, question, answer, category, original_faq_id', q =>
      q.eq('is_active', true).eq('is_own_content', true).not('original_faq_id', 'is', null)
    ),
  ]);

  // Build lookup: original competitor FAQ id → refined version
  const refinedMap = new Map<string, RefinedFaq>();
  allFaqs.forEach(faq => {
    if (faq.original_faq_id) refinedMap.set(faq.original_faq_id, faq);
  });

  // Group by source business
  const bySource: Record<string, (CompetitorFaq & { id: string })[]> = {};
  competitorFaqs.forEach(faq => {
    const key = faq.source_business || 'Unknown Competitor';
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(faq);
  });

  // ===== HEADER =====
  doc.setFillColor(245, 245, 250);
  doc.rect(0, 0, pageWidth, 50, 'F');

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      img.onload = () => { doc.addImage(img, 'PNG', margin, 10, 12, 12); resolve(); };
      img.onerror = () => resolve();
      img.src = bizzybeeLogoSrc;
    });
  } catch { /* skip */ }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Competitor Research Report', margin + 16, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Prepared for ${companyName || 'Your Business'}`, margin + 16, 28);
  doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), pageWidth - margin - 50, 28);

  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(1.5);
  doc.line(margin, 45, pageWidth - margin, 45);
  doc.setTextColor(0, 0, 0);
  y = 58;

  // Summary
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary', margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const sources = Object.keys(bySource);
  const adapted = competitorFaqs.filter(f => refinedMap.has(f.id)).length;
  doc.text(`${competitorFaqs.length} competitor FAQs from ${sources.length} sources. ${adapted} adapted for your business.`, margin, y);
  y += 12;

  // Side-by-side layout
  const colWidth = (contentWidth - 8) / 2; // 8px gap
  const leftX = margin;
  const rightX = margin + colWidth + 8;
  const arrowX = margin + colWidth + 1;

  Object.entries(bySource).forEach(([source, faqs]) => {
    checkPageBreak(30);

    // Source header
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(59, 130, 246);
    doc.text(source, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;

    // Column headers
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('COMPETITOR FAQ', leftX, y);
    doc.text(`ADAPTED FOR ${(companyName || 'YOU').toUpperCase()}`, rightX, y);
    doc.setTextColor(0, 0, 0);
    y += 6;

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(leftX, y, pageWidth - margin, y);
    y += 4;

    faqs.forEach((faq, idx) => {
      const refined = refinedMap.get(faq.id);

      // Calculate heights
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const qLinesLeft = doc.splitTextToSize(`Q: ${faq.question}`, colWidth - 4);
      doc.setFont('helvetica', 'normal');
      const aLinesLeft = doc.splitTextToSize(`A: ${faq.answer}`, colWidth - 4);

      let qLinesRight: string[] = [];
      let aLinesRight: string[] = [];
      if (refined) {
        doc.setFont('helvetica', 'bold');
        qLinesRight = doc.splitTextToSize(`Q: ${refined.question}`, colWidth - 4);
        doc.setFont('helvetica', 'normal');
        aLinesRight = doc.splitTextToSize(`A: ${refined.answer}`, colWidth - 4);
      }

      const leftHeight = (qLinesLeft.length + aLinesLeft.length) * 4 + 6;
      const rightHeight = refined ? (qLinesRight.length + aLinesRight.length) * 4 + 6 : 10;
      const rowHeight = Math.max(leftHeight, rightHeight) + 4;

      checkPageBreak(rowHeight + 4);

      const startY = y;

      // Left column - competitor
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(80, 80, 80);
      doc.text(qLinesLeft, leftX + 2, y);
      y += qLinesLeft.length * 4 + 1;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      doc.text(aLinesLeft, leftX + 2, y);

      // Right column - adapted
      let ry = startY;
      if (refined) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(22, 163, 74); // green
        doc.text(qLinesRight, rightX + 2, ry);
        ry += qLinesRight.length * 4 + 1;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text(aLinesRight, rightX + 2, ry);
      } else {
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('No adapted version yet', rightX + 2, startY);
        doc.setTextColor(0, 0, 0);
      }

      // Arrow between columns
      const arrowY = startY + rowHeight / 2 - 2;
      doc.setFontSize(10);
      doc.setTextColor(59, 130, 246);
      doc.text('→', arrowX, arrowY);
      doc.setTextColor(0, 0, 0);

      y = startY + rowHeight;

      // Separator between rows
      if (idx < faqs.length - 1) {
        doc.setDrawColor(230, 230, 230);
        doc.setLineWidth(0.2);
        doc.line(leftX, y, pageWidth - margin, y);
        y += 3;
      }
    });

    y += 8;
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`BizzyBee Competitor Research • Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  const filename = `BizzyBee-Competitor-Research-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
