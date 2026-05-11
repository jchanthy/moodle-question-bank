import { Injectable } from '@angular/core';
import * as mammoth from 'mammoth';

export interface ParsedQuestion {
  name: string;
  question_text: string;
  qtype: string;
  default_grade: number;
  penalty: number;
  general_feedback: string;
  metadata: Record<string, any>;
  answers: ParsedAnswer[];
  category_path?: string;
}

export interface ParsedAnswer {
  answer_text: string;
  fraction: number;
  feedback: string;
}

@Injectable({ providedIn: 'root' })
export class ImportExportService {

  // ============================================================
  // EXPORT: Moodle XML
  // ============================================================

  exportMoodleXML(questions: any[], answersMap: Map<string, any[]>, categories: any[] = []): string {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n\n`;

    // Build category paths
    const categoryPathMap = new Map<string, string>();
    const getCategoryPath = (categoryId: string): string => {
      if (categoryPathMap.has(categoryId)) return categoryPathMap.get(categoryId)!;
      const cat = categories.find(c => c.id === categoryId);
      if (!cat) return '$course$/top';
      const path = cat.parent_id ? getCategoryPath(cat.parent_id) + '/' + cat.name : '$course$/top/' + cat.name;
      categoryPathMap.set(categoryId, path);
      return path;
    };

    // Group questions by category
    const questionsByCat = new Map<string, any[]>();
    for (const q of questions) {
      const catId = q.category_id || 'unassigned';
      if (!questionsByCat.has(catId)) questionsByCat.set(catId, []);
      questionsByCat.get(catId)!.push(q);
    }

    for (const [catId, qs] of Array.from(questionsByCat.entries())) {
      const path = catId !== 'unassigned' ? getCategoryPath(catId) : '$course$/top';
      xml += `  <question type="category">\n    <category>\n      <text><![CDATA[${path}]]></text>\n    </category>\n  </question>\n\n`;
      
      for (const q of qs) {
        const answers = answersMap.get(q.id) || [];
        xml += this.questionToMoodleXML(q, answers);
      }
    }

    xml += `</quiz>`;
    return xml;
  }

  private questionToMoodleXML(q: any, answers: any[]): string {
    const correctCount = answers.filter(a => a.fraction >= 100).length;
    const isSingle = correctCount <= 1 ? 1 : 0;
    const answersXml = answers.map(a => `    <answer fraction="${a.fraction}" format="html">
      <text><![CDATA[${a.answer_text || ''}]]></text>
      <feedback format="html"><text><![CDATA[${a.feedback || ''}]]></text></feedback>
    </answer>`).join('\n');

    return `  <question type="${q.qtype}">
    <name><text>${this.escapeXML(q.name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${q.question_text || ''}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${q.general_feedback || ''}]]></text>
    </generalfeedback>
    <defaultgrade>${q.default_grade ?? 1}</defaultgrade>
    <penalty>${q.penalty ?? 0.3333333}</penalty>
    <hidden>0</hidden>
    <single>${isSingle}</single>
    <shuffleanswers>${q.metadata?.shuffleanswers ? 1 : 0}</shuffleanswers>
    <answernumbering>${q.metadata?.answernumbering || 'abc'}</answernumbering>
    <tags>
      ${(q.metadata?.tags || []).map((t: string) => `      <tag><text>${this.escapeXML(t)}</text></tag>`).join('\n')}
    </tags>
${answersXml}
  </question>\n\n`;
  }

  // ============================================================
  // EXPORT: GIFT format
  // ============================================================

  exportGIFT(questions: any[], answersMap: Map<string, any[]>): string {
    return questions.map(q => {
      const answers = answersMap.get(q.id) || [];
      return this.questionToGIFT(q, answers);
    }).join('\n\n');
  }

  private questionToGIFT(q: any, answers: any[]): string {
    const header = `::${q.name}::${q.question_text}`;

    if (q.qtype === 'truefalse') {
      const correct = answers.find(a => a.fraction >= 100);
      const val = correct?.answer_text?.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
      return `${header} {${val}}`;
    }

    if (q.qtype === 'shortanswer') {
      const corrects = answers.filter(a => a.fraction >= 100).map(a => `=${a.answer_text}`).join(' ');
      return `${header} {${corrects}}`;
    }

    if (q.qtype === 'essay') {
      return `${header} {}`;
    }

    // multichoice (default)
    const parts = answers.map(a => `\t${a.fraction >= 100 ? '=' : '~'}${a.answer_text}`).join('\n');
    return `${header} {\n${parts}\n}`;
  }

  // ============================================================
  // IMPORT: Moodle XML
  // ============================================================

  parseMoodleXML(xmlString: string): ParsedQuestion[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) throw new Error('Invalid XML file. Please check the file format.');

    const questions: ParsedQuestion[] = [];
    let currentCategoryPath = '';

    doc.querySelectorAll('question').forEach(qEl => {
      const type = qEl.getAttribute('type');
      if (type === 'category') {
        const catEl = qEl.getElementsByTagName('category')[0];
        const textEl = catEl?.getElementsByTagName('text')[0];
        currentCategoryPath = textEl?.textContent?.trim() || '';
        return;
      }
      if (!type) return;

      const getText = (selector: string): string => {
        const el = qEl.querySelector(selector + ' > text');
        return el?.textContent?.trim() || '';
      };

      const answers: ParsedAnswer[] = [];
      qEl.querySelectorAll('answer').forEach(aEl => {
        const text = this.cleanHtml(aEl.querySelector('text')?.textContent?.trim() || '');
        const feedback = this.cleanHtml(aEl.querySelector('feedback > text')?.textContent?.trim() || '');
        const fraction = parseFloat(aEl.getAttribute('fraction') || '0');
        answers.push({ answer_text: text, fraction, feedback });
      });

      questions.push({
        name: this.cleanHtml(getText('name')),
        question_text: this.cleanHtml(getText('questiontext')),
        qtype: type,
        default_grade: parseFloat(qEl.querySelector('defaultgrade')?.textContent || '1'),
        penalty: parseFloat(qEl.querySelector('penalty')?.textContent || '0'),
        general_feedback: this.cleanHtml(getText('generalfeedback')),
        metadata: {
          shuffleanswers: qEl.querySelector('shuffleanswers')?.textContent === '1',
          answernumbering: qEl.querySelector('answernumbering')?.textContent || 'abc',
          tags: Array.from(qEl.querySelectorAll('tags > tag > text')).map(t => t.textContent?.trim() || '').filter(Boolean)
        },
        answers,
        category_path: currentCategoryPath,
      });
    });

    return questions;
  }

  // ============================================================
  // IMPORT: GIFT format
  // ============================================================

  parseGIFT(giftText: string): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    // Remove line comments
    const cleaned = giftText.replace(/\/\/[^\n]*/g, '').trim();
    // Split on blank lines between questions
    const blocks = cleaned.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

    let currentCategory = '';
    for (const block of blocks) {
      if (block.startsWith('$CATEGORY:')) {
        currentCategory = block.replace('$CATEGORY:', '').trim();
        continue;
      }
      const parsed = this.parseGIFTBlock(block);
      if (parsed) {
        parsed.category_path = currentCategory;
        questions.push(parsed);
      }
    }

    return questions;
  }

  private parseGIFTBlock(block: string): ParsedQuestion | null {
    try {
      let name = '';
      let remaining = block.trim();

      // Extract ::name::
      const nameMatch = remaining.match(/^::([^:]+)::/);
      if (nameMatch) {
        name = nameMatch[1].trim();
        remaining = remaining.slice(nameMatch[0].length).trim();
      }

      // Split question text from answer block
      const braceStart = remaining.indexOf('{');
      if (braceStart === -1) return null;

      const questionText = remaining.slice(0, braceStart).trim();
      const braceEnd = remaining.lastIndexOf('}');
      const answerBlock = remaining.slice(braceStart + 1, braceEnd).trim();

      if (!name) name = questionText.substring(0, 60);

      const { qtype, answers } = this.parseGIFTAnswerBlock(answerBlock);
      return {
        name,
        question_text: questionText,
        qtype,
        default_grade: 1,
        penalty: 0,
        general_feedback: '',
        metadata: {},
        answers,
      };
    } catch {
      return null;
    }
  }

  private parseGIFTAnswerBlock(block: string): { qtype: string; answers: ParsedAnswer[] } {
    const answers: ParsedAnswer[] = [];

    if (block === '') {
      return { qtype: 'essay', answers: [] };
    }

    const upper = block.toUpperCase().trim();
    if (upper === 'TRUE' || upper === 'T') {
      return {
        qtype: 'truefalse',
        answers: [
          { answer_text: 'True', fraction: 100, feedback: '' },
          { answer_text: 'False', fraction: 0, feedback: '' },
        ],
      };
    }
    if (upper === 'FALSE' || upper === 'F') {
      return {
        qtype: 'truefalse',
        answers: [
          { answer_text: 'True', fraction: 0, feedback: '' },
          { answer_text: 'False', fraction: 100, feedback: '' },
        ],
      };
    }

    // Short answer: only = signs, no ~
    if (block.includes('=') && !block.includes('~')) {
      const parts = block.split('=').map(p => p.trim()).filter(Boolean);
      return {
        qtype: 'shortanswer',
        answers: parts.map(p => ({ answer_text: p, fraction: 100, feedback: '' })),
      };
    }

    // Multiple choice
    const parts = block.split(/(?=[=~])/).map(p => p.trim()).filter(Boolean);
    parts.forEach(part => {
      const isCorrect = part.startsWith('=');
      const text = part.slice(1).trim();
      // Strip inline feedback #...
      const cleanText = text.split('#')[0].trim();
      answers.push({ answer_text: cleanText, fraction: isCorrect ? 100 : 0, feedback: '' });
    });

    return { qtype: 'multichoice', answers };
  }

  // ============================================================
  // IMPORT: Structured Export format (Custom)
  // ============================================================

  parseStructuredExport(text: string): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    // Split by the horizontal line separator often used in exports
    const blocks = text.split(/_{5,}/).map(b => b.trim()).filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 5) continue;

      let name = '';
      let qtype = 'multichoice';
      let tags: string[] = [];
      let questionTextLines: string[] = [];
      let optionsStarted = false;
      let choices: { key: string, text: string }[] = [];
      let correctKey = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('Question:')) {
          name = line.replace('Question:', '').trim();
        } else if (line.startsWith('Type:')) {
          qtype = line.replace('Type:', '').trim().toLowerCase();
        } else if (line.startsWith('Tags:')) {
          tags = line.replace('Tags:', '').split(',').map(t => t.trim());
        } else if (line.toLowerCase().startsWith('options:')) {
          optionsStarted = true;
        } else if (line.match(/^(Answer|ANSWER):/i)) {
          const match = line.match(/^(Answer|ANSWER):\s*([A-Za-z])$/i);
          if (match) correctKey = match[2].toUpperCase();
        } else if (optionsStarted) {
          const choiceMatch = line.match(/^([A-Za-z])[.)]\s+(.+)$/);
          if (choiceMatch) {
            choices.push({ key: choiceMatch[1].toUpperCase(), text: choiceMatch[2] });
          }
        } else {
          // If it doesn't match any headers and options haven't started, it's question text
          if (name && !optionsStarted) {
            questionTextLines.push(line);
          }
        }
      }

      if (choices.length > 0 && correctKey) {
        const answers: ParsedAnswer[] = choices.map(c => ({
          answer_text: c.text,
          fraction: c.key === correctKey ? 100 : 0,
          feedback: ''
        }));

        questions.push({
          name: name || questionTextLines[0]?.substring(0, 60) || 'Imported Question',
          question_text: questionTextLines.join('\n'),
          qtype: qtype || 'multichoice',
          default_grade: 1,
          penalty: 0.3333333,
          general_feedback: '',
          metadata: { tags },
          answers
        });
      }
    }

    return questions;
  }

  // ============================================================
  // IMPORT: Aiken format
  // ============================================================

  parseAiken(aikenText: string): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    // Normalize line endings and split into blocks by blank lines
    const normalized = aikenText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.trim().split(/\n\s*\n/);

    for (const block of blocks) {
      const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 3) continue;

      const questionText = lines[0];
      const choices: string[] = [];
      let answerKey = '';

      for (let i = 1; i < lines.length; i++) {
        // More flexible choice match: A. A) a. a)
        const choiceMatch = lines[i].match(/^([A-Za-z])[.)]\s+(.+)$/);
        // More flexible answer match: ANSWER: A, Answer: A, ans: A
        const answerMatch = lines[i].match(/^(ANSWER|Answer|ans)[:\s]\s*([A-Za-z])$/i);

        if (choiceMatch) {
          choices.push(choiceMatch[2]);
        } else if (answerMatch) {
          answerKey = answerMatch[2].toUpperCase();
        }
      }

      if (!answerKey || choices.length === 0) continue;

      const answerIndex = answerKey.charCodeAt(0) - 65;
      if (answerIndex < 0 || answerIndex >= choices.length) continue;

      const answers: ParsedAnswer[] = choices.map((c, i) => ({
        answer_text: c,
        fraction: i === answerIndex ? 100 : 0,
        feedback: '',
      }));

      questions.push({
        name: questionText.substring(0, 60),
        question_text: questionText,
        qtype: 'multichoice',
        default_grade: 1,
        penalty: 0,
        general_feedback: '',
        metadata: {},
        answers,
      });
    }

    return questions;
  }

  // ============================================================
  // IMPORT: Word (.docx)
  // ============================================================
  
  async parseDocx(arrayBuffer: ArrayBuffer): Promise<ParsedQuestion[]> {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = this.normalizeWordText(result.value);
      
      // 1. Try Structured Export first (your custom format)
      let questions = this.parseStructuredExport(text);
      
      // 2. If no structured questions found, try Aiken
      if (questions.length === 0) {
        questions = this.parseAiken(text);
      }
      
      // 3. If still nothing, try GIFT
      if (questions.length === 0) {
        questions = this.parseGIFT(text);
      }
      
      return questions;
    } catch (error) {
      console.error('Error parsing DOCX:', error);
      throw new Error('Failed to extract text from Word document. Ensure it is a valid .docx file.');
    }
  }

  private normalizeWordText(text: string): string {
    return text
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"') // Smart double quotes
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'") // Smart single quotes
      .replace(/\u2013/g, "-") // En dash
      .replace(/\u2014/g, "--") // Em dash
      .replace(/\u2026/g, "...") // Ellipsis
      .replace(/\u00A0/g, " ") // Non-breaking space
      .replace(/\r\n/g, "\n") // Windows line endings
      .replace(/\r/g, "\n");  // Mac line endings
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  downloadFile(content: string, filename: string, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private escapeXML(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Strip all HTML tags and decode entities to get clean plain text.
   * Handles: <p>, <br>, <span lang="...">, <strong>, &nbsp;, etc.
   */
  cleanHtml(html: string): string {
    if (!html || !html.trim()) return '';

    // Use DOMParser to parse HTML safely
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Replace <br> and <p> closing tags with newlines before stripping
    doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    doc.querySelectorAll('p').forEach(p => {
      p.after('\n');
    });

    // Get plain text (strips all remaining tags, decodes entities)
    let text = doc.body.textContent || '';

    // Normalize whitespace:
    // 1. Replace multiple consecutive newlines with a single one
    text = text.replace(/\n{2,}/g, '\n');
    // 2. Replace non-breaking spaces
    text = text.replace(/\u00a0/g, ' ');
    // 3. Collapse multiple spaces
    text = text.replace(/ {2,}/g, ' ');
    // 4. Trim each line
    text = text.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
    // 5. Final trim
    return text.trim();
  }
}
