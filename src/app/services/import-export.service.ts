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

  /**
   * Moodle has a hardcoded list of allowed answer fraction values (0-100 percentage scale).
   * Any fraction not exactly matching one of these values will cause an import error:
   * "Grades (...) do not match grade options - question skipped."
   *
   * This function snaps any raw stored value (including old integer-rounded values like 33)
   * to the nearest Moodle-allowed fraction.
   */
  private readonly MOODLE_ALLOWED_FRACTIONS = [
    -100, -83.33333, -75, -66.66667, -60, -50,
    -40, -33.33333, -25, -20, -16.66667, -10,
    0,
    10, 16.66667, 20, 25, 33.33333, 40, 50,
    60, 66.66667, 75, 80, 83.33333, 90, 100
  ];

  private snapToMoodleFraction(raw: number): number {
    // If it already exactly matches, return it
    if (this.MOODLE_ALLOWED_FRACTIONS.includes(raw)) return raw;

    // Find the nearest allowed fraction by absolute distance
    let best = this.MOODLE_ALLOWED_FRACTIONS[0];
    let bestDist = Math.abs(raw - best);
    for (const allowed of this.MOODLE_ALLOWED_FRACTIONS) {
      const dist = Math.abs(raw - allowed);
      if (dist < bestDist) {
        bestDist = dist;
        best = allowed;
      }
    }
    return best;
  }

  private getQuestionTextWithIllustration(q: any): string {
    let qtext = q.question_text || '';
    const imageUrl = q.metadata?.image_url || q.image_url;
    if (imageUrl) {
      qtext += `<p><img src="${imageUrl}" style="max-height: 300px; display: block; margin-top: 12px;" /></p>`;
    }
    return qtext;
  }

  private questionToMoodleXML(q: any, answers: any[]): string {
    // Dispatch to type-specific exporters for correct Moodle XML structure
    if (q.qtype === 'truefalse') {
      return this.trueFalseToMoodleXML(q, answers);
    }
    if (q.qtype === 'match') {
      return this.matchToMoodleXML(q, answers);
    }
    if (q.qtype === 'ddmarker') {
      return this.ddMarkerToMoodleXML(q, answers);
    }
    if (q.qtype === 'gapfill') {
      return this.gapfillToMoodleXML(q, answers);
    }
    return this.genericToMoodleXML(q, answers);
  }

  private gapfillToMoodleXML(q: any, answers: any[]): string {
    const mode = q.metadata?.gapfill_mode || 'dragdrop';
    const answerdisplay = mode === 'text' ? 'gapfill' : mode;
    const delimiters = q.metadata?.gapfill_delimiters || '[]';
    const casesensitive = q.metadata?.gapfill_casesensitive ? 1 : 0;
    const fixedgapsize = q.metadata?.gapfill_fixedgapsize !== false ? 1 : 0;

    const answersXml = answers.map(a => `    <answer fraction="0" format="html">
      <text><![CDATA[${a.answer_text || ''}]]></text>
      <feedback format="html"><text><![CDATA[${a.feedback || ''}]]></text></feedback>
    </answer>`).join('\n');

    const tags = (q.metadata?.tags || [])
      .map((t: string) => `      <tag><text>${this.escapeXML(t)}</text></tag>`).join('\n');

    return `  <question type="gapfill">
    <name><text>${this.escapeXML(q.name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${this.getQuestionTextWithIllustration(q)}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${q.general_feedback || ''}]]></text>
    </generalfeedback>
    <defaultgrade>${q.default_grade ?? 1}</defaultgrade>
    <penalty>${q.penalty ?? 0.3333333}</penalty>
    <hidden>0</hidden>
    <answerdisplay>${answerdisplay}</answerdisplay>
    <delimitchars>${this.escapeXML(delimiters)}</delimitchars>
    <casesensitive>${casesensitive}</casesensitive>
    <fixedgapsize>${fixedgapsize}</fixedgapsize>
    <tags>
      ${tags}
    </tags>
\n${answersXml}
  </question>\n\n`;
  }

  /**
   * True/False questions have a unique Moodle XML structure:
   * - Answer text must be exactly "true" or "false" (lowercase plain text, no HTML)
   * - format="moodle_auto_format" on each <answer>
   * - No <single>, <shuffleanswers>, <answernumbering> tags
   * - Penalty is 1 (Moodle default for TF – full penalty on retry)
   */
  private trueFalseToMoodleXML(q: any, answers: any[]): string {
    // Determine which answer is correct by finding the one with fraction > 0
    const correctAnswer = answers.find(a => Number(a.fraction) > 0);
    const correctText = (correctAnswer?.answer_text || 'True')
      .replace(/<[^>]*>/g, '').trim().toLowerCase(); // strip any HTML, lowercase

    // Moodle TF needs exactly "true" and "false" with the right fractions
    const trueIsCorrect = correctText === 'true';
    const trueFraction  = trueIsCorrect ? 100 : 0;
    const falseFraction = trueIsCorrect ? 0   : 100;

    // Feedback for each side (strip HTML so it exports cleanly)
    const trueFb  = answers.find(a => a.answer_text?.replace(/<[^>]*>/g,'').trim().toLowerCase() === 'true')?.feedback || '';
    const falseFb = answers.find(a => a.answer_text?.replace(/<[^>]*>/g,'').trim().toLowerCase() === 'false')?.feedback || '';

    const tags = (q.metadata?.tags || [])
      .map((t: string) => `      <tag><text>${this.escapeXML(t)}</text></tag>`).join('\n');

    return `  <question type="truefalse">
    <name><text>${this.escapeXML(q.name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${this.getQuestionTextWithIllustration(q)}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${q.general_feedback || ''}]]></text>
    </generalfeedback>
    <defaultgrade>${q.default_grade ?? 1}</defaultgrade>
    <penalty>1</penalty>
    <hidden>0</hidden>
    <tags>
      ${tags}
    </tags>
    <answer fraction="${trueFraction}" format="moodle_auto_format">
      <text>true</text>
      <feedback format="html"><text><![CDATA[${trueFb}]]></text></feedback>
    </answer>
    <answer fraction="${falseFraction}" format="moodle_auto_format">
      <text>false</text>
      <feedback format="html"><text><![CDATA[${falseFb}]]></text></feedback>
    </answer>
  </question>\n\n`;
  }

  /**
   * Generic exporter for multichoice, shortanswer, numerical, essay, match, etc.
   * MCQ-specific tags (single, shuffleanswers, answernumbering) are only emitted
   * for question types that actually use them.
   */
  private genericToMoodleXML(q: any, answers: any[]): string {
    const isMCQ = ['multichoice', 'multichoiceanswernone'].includes(q.qtype);

    // For single-answer MCQ: determine from metadata first, fall back to answer count
    const metaSingle = q.metadata?.single;
    const correctCount = answers.filter(a => Number(a.fraction) > 0).length;
    const isSingle = metaSingle !== undefined
      ? (metaSingle ? 1 : 0)
      : (correctCount <= 1 ? 1 : 0);

    // Build answer XML – fractions are stored as 0-100 percentages.
    // snapToMoodleFraction maps any value (including old integer-rounded ones like 33)
    // to the nearest value in Moodle's hardcoded allowed list (e.g. 33 → 33.33333).
    const answersXml = answers.map(a => {
      const frac = this.snapToMoodleFraction(Number(a.fraction));
      return `    <answer fraction="${frac}" format="html">
      <text><![CDATA[${a.answer_text || ''}]]></text>
      <feedback format="html"><text><![CDATA[${a.feedback || ''}]]></text></feedback>
    </answer>`;
    }).join('\n');

    const tags = (q.metadata?.tags || [])
      .map((t: string) => `      <tag><text>${this.escapeXML(t)}</text></tag>`).join('\n');

    // MCQ-specific block (only output for multichoice types)
    let mcqBlock = '';
    if (isMCQ) {
      const correctFeedback = q.metadata?.correct_feedback || 'Your answer is correct.';
      const partiallyCorrectFeedback = q.metadata?.partially_correct_feedback || 'Your answer is partially correct.';
      const incorrectFeedback = q.metadata?.incorrect_feedback || 'Your answer is incorrect.';
      const showNumCorrect = q.metadata?.show_num_correct !== false ? '\n    <shownumcorrect/>' : '';

      mcqBlock = `
    <single>${isSingle}</single>
    <shuffleanswers>${q.metadata?.shuffleanswers ? 1 : 0}</shuffleanswers>
    <answernumbering>${q.metadata?.answernumbering || 'abc'}</answernumbering>
    <correctfeedback format="html">
      <text><![CDATA[${correctFeedback}]]></text>
    </correctfeedback>
    <partiallycorrectfeedback format="html">
      <text><![CDATA[${partiallyCorrectFeedback}]]></text>
    </partiallycorrectfeedback>
    <incorrectfeedback format="html">
      <text><![CDATA[${incorrectFeedback}]]></text>
    </incorrectfeedback>${showNumCorrect}`;
    }

    return `  <question type="${q.qtype}">
    <name><text>${this.escapeXML(q.name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${this.getQuestionTextWithIllustration(q)}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${q.general_feedback || ''}]]></text>
    </generalfeedback>
    <defaultgrade>${q.default_grade ?? 1}</defaultgrade>
    <penalty>${q.penalty ?? 0.3333333}</penalty>
    <hidden>0</hidden>${mcqBlock}
    <tags>
      ${tags}
    </tags>
${answersXml}
  </question>\n\n`;
  }

  private matchToMoodleXML(q: any, answers: any[]): string {
    const shuffleAnswers = q.metadata?.shuffleanswers ? 1 : 0;
    const subquestionsXml = answers.map(a => {
      const { text } = this.parseAnswerTextAndImage(a.answer_text);
      let subQ = '';
      let matchA = '';
      const parts = text.split(' | ');
      if (parts.length > 1) {
        subQ = parts[0];
        matchA = parts.slice(1).join(' | ');
      } else {
        subQ = '';
        matchA = text;
      }
      return `    <subquestion format="html">
      <text><![CDATA[${subQ}]]></text>
      <answer><text><![CDATA[${matchA}]]></text></answer>
    </subquestion>`;
    }).join('\n');

    const tags = (q.metadata?.tags || [])
      .map((t: string) => `      <tag><text>${this.escapeXML(t)}</text></tag>`).join('\n');

    return `  <question type="match">
    <name><text>${this.escapeXML(q.name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${this.getQuestionTextWithIllustration(q)}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${q.general_feedback || ''}]]></text>
    </generalfeedback>
    <defaultgrade>${q.default_grade ?? 1}</defaultgrade>
    <penalty>${q.penalty ?? 0.3333333}</penalty>
    <hidden>0</hidden>
    <shuffleanswers>${shuffleAnswers}</shuffleanswers>
    <tags>
      ${tags}
    </tags>
${subquestionsXml}
  </question>\n\n`;
  }

  private parseAnswerTextAndImage(html: string): { text: string, imageUrl: string } {
    if (!html) return { text: '', imageUrl: '' };
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
    const match = html.match(imgRegex);
    if (match && match[1]) {
      const imageUrl = match[1];
      const text = html.replace(imgRegex, '').trim();
      return { text, imageUrl };
    }
    return { text: html, imageUrl: '' };
  }

  private ddMarkerToMoodleXML(q: any, answers: any[]): string {
    const shuffleAnswers = q.metadata?.shuffleanswers ? 1 : 0;
    let dragsXml = '';
    let dropsXml = '';

    answers.forEach((ans: any, idx: number) => {
      const markerNo = idx + 1;
      const markerText = ans.answer_text || '';
      const feedbackText = ans.feedback || '';
      const parts = feedbackText.split(' | ');
      const shape = parts[0] || 'circle';
      const coords = parts[1] || '';
      const infinite = parts[2] !== 'false';

      dragsXml += `    <drag>
      <no>${markerNo}</no>
      <text>${this.escapeXML(markerText)}</text>
      <value>${infinite ? 1 : 0}</value>
    </drag>\n`;

      if (coords) {
        dropsXml += `    <drop>
      <no>${markerNo}</no>
      <shape>${shape}</shape>
      <coords>${coords}</coords>
      <choice>${markerNo}</choice>
    </drop>\n`;
      }
    });

    const tags = (q.metadata?.tags || [])
      .map((t: string) => `      <tag><text>${this.escapeXML(t)}</text></tag>`).join('\n');

    return `  <question type="ddmarker">
    <name><text>${this.escapeXML(q.name)}</text></name>
    <questiontext format="html">
      <text><![CDATA[${this.getQuestionTextWithIllustration(q)}]]></text>
    </questiontext>
    <generalfeedback format="html">
      <text><![CDATA[${q.general_feedback || ''}]]></text>
    </generalfeedback>
    <defaultgrade>${q.default_grade ?? 1}</defaultgrade>
    <penalty>${q.penalty ?? 0.3333333}</penalty>
    <hidden>0</hidden>
    <shuffleanswers>${shuffleAnswers}</shuffleanswers>
    <tags>
      ${tags}
    </tags>
${dragsXml}
${dropsXml}
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

  private parseSimplifiedXML(doc: Document): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    doc.querySelectorAll('question').forEach(qEl => {
      // Check if it matches this simplified format (has <text> and <options>)
      const textEl = qEl.querySelector('text');
      const optionsEl = qEl.querySelector('options');
      if (!textEl || !optionsEl) return;

      const text = textEl.textContent?.trim() || '';
      const level = qEl.querySelector('level')?.textContent?.trim() || '';
      const answerVal = qEl.querySelector('answer')?.textContent?.trim() || '';

      const name = text.length > 60 ? text.substring(0, 60) + '...' : text;

      const answers: ParsedAnswer[] = [];
      qEl.querySelectorAll('option').forEach(optEl => {
        const val = optEl.getAttribute('val') || '';
        const optText = optEl.textContent?.trim() || '';
        const isCorrect = val.toLowerCase() === answerVal.toLowerCase();

        answers.push({
          answer_text: optText,
          fraction: isCorrect ? 100 : 0,
          feedback: ''
        });
      });

      questions.push({
        name: name,
        question_text: text,
        qtype: 'multichoice',
        default_grade: 1,
        penalty: 0.3333333,
        general_feedback: '',
        answers: answers,
        metadata: {
          level: level,
          tags: level ? [level] : []
        }
      });
    });

    return questions;
  }

  // ============================================================
  // IMPORT: Moodle XML
  // ============================================================

  parseMoodleXML(xmlString: string): ParsedQuestion[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) throw new Error('Invalid XML file. Please check the file format.');

    const hasOptions = doc.querySelector('question > options');
    if (hasOptions) {
      return this.parseSimplifiedXML(doc);
    }

    if (doc.querySelector('digital_economy_quiz') || doc.querySelector('multiple_choice_questions') || doc.querySelector('matching_exercises') || doc.querySelector('general_sections')) {
      return this.parseCustomXML(doc);
    }

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
      if (type === 'match') {
        qEl.querySelectorAll('subquestion').forEach(subEl => {
          const rawSubText = subEl.querySelector('text')?.textContent?.trim() || '';
          const ansText = this.cleanHtml(subEl.querySelector('answer > text')?.textContent?.trim() || '');
          
          // Extract image tag if any
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
          const match = rawSubText.match(imgRegex);
          const imageUrl = match ? match[1] : '';
          
          const cleanSubText = this.cleanHtml(rawSubText);
          let combinedText = cleanSubText;
          if (imageUrl) {
            combinedText = `${cleanSubText} <img src="${imageUrl}" style="max-height: 120px; display: block; margin-top: 8px;" />`;
          }
          combinedText = `${combinedText} | ${ansText}`;
          
          answers.push({
            answer_text: combinedText,
            fraction: 0,
            feedback: ''
          });
        });
      } else if (type === 'ddmarker') {
        const markerMap = new Map<string, { text: string; infinite: boolean }>();
        qEl.querySelectorAll('drag').forEach(dEl => {
          const no = dEl.querySelector('no')?.textContent?.trim() || '';
          const text = dEl.querySelector('text')?.textContent?.trim() || '';
          const value = dEl.querySelector('value')?.textContent?.trim() || '0';
          const infinite = value === '1';
          markerMap.set(no, { text, infinite });
        });

        qEl.querySelectorAll('drop').forEach(drEl => {
          const no = drEl.querySelector('no')?.textContent?.trim() || '';
          const shape = drEl.querySelector('shape')?.textContent?.trim() || 'circle';
          const coords = drEl.querySelector('coords')?.textContent?.trim() || '';
          const choice = drEl.querySelector('choice')?.textContent?.trim() || '';

          const marker = markerMap.get(choice);
          if (marker) {
            answers.push({
              answer_text: marker.text,
              fraction: 0,
              feedback: `${shape} | ${coords} | ${marker.infinite}`
            });
            markerMap.delete(choice);
          }
        });

        markerMap.forEach((marker) => {
          answers.push({
            answer_text: marker.text,
            fraction: 0,
            feedback: `circle |  | ${marker.infinite}`
          });
        });
      } else {
        qEl.querySelectorAll('answer').forEach(aEl => {
          const text = this.cleanHtml(aEl.querySelector('text')?.textContent?.trim() || '');
          const feedback = this.cleanHtml(aEl.querySelector('feedback > text')?.textContent?.trim() || '');
          const fraction = parseFloat(aEl.getAttribute('fraction') || '0');
          answers.push({ answer_text: text, fraction, feedback });
        });
      }

      questions.push({
        name: this.cleanHtml(getText('name')),
        question_text: this.cleanHtml(getText('questiontext')),
        qtype: type,
        default_grade: parseFloat(qEl.querySelector('defaultgrade')?.textContent || '1'),
        penalty: parseFloat(qEl.querySelector('penalty')?.textContent || '0'),
        general_feedback: this.cleanHtml(getText('generalfeedback')),
        metadata: (() => {
          const meta: Record<string, any> = {
            shuffleanswers: qEl.querySelector('shuffleanswers')?.textContent === '1',
            answernumbering: qEl.querySelector('answernumbering')?.textContent || 'abc',
            correct_feedback: this.cleanHtml(qEl.querySelector('correctfeedback > text')?.textContent || ''),
            partially_correct_feedback: this.cleanHtml(qEl.querySelector('partiallycorrectfeedback > text')?.textContent || ''),
            incorrect_feedback: this.cleanHtml(qEl.querySelector('incorrectfeedback > text')?.textContent || ''),
            show_num_correct: qEl.querySelector('shownumcorrect') !== null,
            tags: Array.from(qEl.querySelectorAll('tags > tag > text')).map(t => t.textContent?.trim() || '').filter(Boolean)
          };
          if (type === 'gapfill') {
            const display = qEl.querySelector('answerdisplay')?.textContent?.trim() || 'dragdrop';
            meta['gapfill_mode'] = display === 'gapfill' ? 'text' : display;
            meta['gapfill_delimiters'] = qEl.querySelector('delimitchars')?.textContent?.trim() || '[]';
            meta['gapfill_casesensitive'] = qEl.querySelector('casesensitive')?.textContent?.trim() === '1';
            meta['gapfill_fixedgapsize'] = qEl.querySelector('fixedgapsize')?.textContent?.trim() !== '0';
          }
          return meta;
        })(),
        answers,
        category_path: currentCategoryPath,
      });
    });

    return questions;
  }

  private parseCustomXML(doc: Document): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];

    // 1. Parse Q&A Pairs under general_sections -> section -> qa_pair
    doc.querySelectorAll('general_sections section').forEach(secEl => {
      const sectionTitle = secEl.getAttribute('title') || '';
      const catPath = sectionTitle ? `General Sections/${sectionTitle}` : 'General Sections';

      secEl.querySelectorAll('qa_pair').forEach(qaEl => {
        const qText = qaEl.querySelector('question')?.textContent?.trim() || '';
        const aText = qaEl.querySelector('answer')?.textContent?.trim() || '';
        if (!qText) return;

        // Parse as essay/shortanswer
        questions.push({
          name: qText.substring(0, 60),
          question_text: qText,
          qtype: 'essay',
          default_grade: 1,
          penalty: 0,
          general_feedback: '',
          metadata: {
            tags: ['general', 'q&a']
          },
          answers: [
            {
              answer_text: aText,
              fraction: 100,
              feedback: 'Correct answer guide.'
            }
          ],
          category_path: catPath
        });
      });
    });

    // 2. Parse Multiple Choice Questions
    doc.querySelectorAll('multiple_choice_questions question').forEach(mcEl => {
      const qText = mcEl.querySelector('text')?.textContent?.trim() || '';
      const correctKey = mcEl.querySelector('correct_answer')?.textContent?.trim() || '';
      const difficulty = mcEl.getAttribute('difficulty') || '';

      const answers: ParsedAnswer[] = [];
      mcEl.querySelectorAll('options option').forEach(optEl => {
        const optId = optEl.getAttribute('id') || '';
        const optText = optEl.textContent?.trim() || '';
        const isCorrect = optId.toUpperCase() === correctKey.toUpperCase();

        answers.push({
          answer_text: optText,
          fraction: isCorrect ? 100 : 0,
          feedback: isCorrect ? 'Correct!' : 'Incorrect.'
        });
      });

      if (!qText) return;

      questions.push({
        name: qText.substring(0, 60),
        question_text: qText,
        qtype: 'multichoice',
        default_grade: 1,
        penalty: 0.3333333,
        general_feedback: '',
        metadata: {
          tags: difficulty ? [difficulty] : []
        },
        answers,
        category_path: 'Multiple Choice Questions'
      });
    });

    // 3. Parse Matching Exercises
    doc.querySelectorAll('matching_exercises exercise').forEach(exEl => {
      const title = exEl.getAttribute('title') || '';
      const answers: ParsedAnswer[] = [];

      exEl.querySelectorAll('pairs pair').forEach(pairEl => {
        const left = pairEl.querySelector('left')?.textContent?.trim() || '';
        const right = pairEl.querySelector('right')?.textContent?.trim() || '';
        
        // Match format text: left | right
        answers.push({
          answer_text: `${left} | ${right}`,
          fraction: 0,
          feedback: ''
        });
      });

      if (answers.length === 0) return;

      questions.push({
        name: title || 'Matching Exercise',
        question_text: `Match the following terms: ${title}`,
        qtype: 'match',
        default_grade: 1,
        penalty: 0.3333333,
        general_feedback: '',
        metadata: {},
        answers,
        category_path: 'Matching Exercises'
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
      
      // 2. If no structured questions found, use our robust smart layout-aware parser
      if (questions.length === 0) {
        questions = this.parseSmart(text);
      }
      
      // 3. If still nothing, try GIFT as a final fallback
      if (questions.length === 0) {
        questions = this.parseGIFT(text);
      }
      
      return questions;
    } catch (error) {
      console.error('Error parsing DOCX:', error);
      throw new Error('Failed to extract text from Word document. Ensure it is a valid .docx file.');
    }
  }

  parseSmart(text: string): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    let currentLevel = '';
    
    interface TempChoice {
      key: string;
      text: string;
      isCorrect: boolean;
    }

    let currentQuestion = {
      question_text: [] as string[],
      choices: [] as TempChoice[],
      correctKey: null as string | null
    };

    const flushCurrent = () => {
      if (currentQuestion.question_text.length > 0 && currentQuestion.choices.length > 0) {
        const qText = currentQuestion.question_text.join('\n').trim();
        const choices = currentQuestion.choices;
        const correctKey = currentQuestion.correctKey;

        const answers: ParsedAnswer[] = choices.map(c => {
          let isCorrect = false;
          if (correctKey) {
            isCorrect = c.key.toUpperCase() === correctKey.toUpperCase();
          } else {
            isCorrect = c.isCorrect;
          }
          return {
            answer_text: c.text,
            fraction: isCorrect ? 100 : 0,
            feedback: ''
          };
        });

        // Ensure at least one correct answer exists
        if (!answers.some(a => a.fraction > 0) && answers.length > 0) {
          answers[0].fraction = 100;
        }

        // True/False detection
        let qtype = 'multichoice';
        if (answers.length === 2) {
          const t1 = answers[0].answer_text.toLowerCase();
          const t2 = answers[1].answer_text.toLowerCase();
          if ((t1 === 'true' && t2 === 'false') || (t1 === 'yes' && t2 === 'no')) {
            qtype = 'truefalse';
          }
        }

        questions.push({
          name: qText.substring(0, 60),
          question_text: qText,
          qtype,
          default_grade: 1,
          penalty: qtype === 'truefalse' ? 0 : 0.3333333,
          general_feedback: '',
          metadata: currentLevel ? { level: currentLevel, tags: [currentLevel] } : {},
          answers
        });
      }

      currentQuestion = {
        question_text: [] as string[],
        choices: [] as TempChoice[],
        correctKey: null
      };
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];

      // Check for Level headers (e.g. "Level 1:" or "L1" or "Level 1")
      const levelMatch = line.match(/^\s*(Level|L)\s*(\d+)[:.\-]?\s*$/i);
      if (levelMatch) {
        currentLevel = `Level ${levelMatch[2]}`;
        continue;
      }

      // 1. Answer line check
      const answerMatch = line.match(/^(ANSWER|Answer|ans|correct|key|correct\s+answer|correct\s+option|answer\s+key)[:\-=\s]+\s*([A-Za-z0-9])$/i);
      if (answerMatch) {
        currentQuestion.correctKey = answerMatch[2].toUpperCase();
        continue;
      }

      // 2. Choice option check
      let isChoice = false;
      let choiceKey = '';
      let choiceText = '';
      let isCorrectInline = false;

      // Bracket style check: [x] A. Text or [ ] B. Text
      const bracketMatch = line.match(/^\[([xX✔*\s]?)\]\s*([A-Za-z])[.)\-]?\s*(.+)$/i);
      if (bracketMatch) {
        isChoice = true;
        choiceKey = bracketMatch[2].toUpperCase();
        choiceText = bracketMatch[3].trim();
        isCorrectInline = ['x', 'X', '✔', '*'].includes(bracketMatch[1].trim());
      } else {
        // Option prefix check: *A. Text or A. *Text or A. Text
        const prefixMatch = line.match(/^([*✔]?)\s*([A-Za-z])\s*([.)\-]+)\s*(.*)$/i);
        if (prefixMatch) {
          isChoice = true;
          choiceKey = prefixMatch[2].toUpperCase();
          let remainingText = prefixMatch[3].trim();

          const inlineCorrectMatch = remainingText.match(/^([*✔]|\[[xX✔*]\])\s*(.*)$/);
          if (prefixMatch[1] || inlineCorrectMatch) {
            isCorrectInline = true;
            if (inlineCorrectMatch) {
              remainingText = inlineCorrectMatch[2].trim();
            }
          }

          const suffixCorrectMatch = remainingText.match(/^(.*?)\s*([*✔]|\(Correct\)|\(correct\))$/);
          if (suffixCorrectMatch) {
            isCorrectInline = true;
            remainingText = suffixCorrectMatch[1].trim();
          }

          choiceText = remainingText;
        }
      }

      if (isChoice) {
        currentQuestion.choices.push({
          key: choiceKey,
          text: choiceText,
          isCorrect: isCorrectInline
        });
        if (isCorrectInline) {
          currentQuestion.correctKey = choiceKey;
        }
        continue;
      }

      // 3. Question Header check
      const qHeaderMatch = line.match(/^(Question|Q|No|Num)?\s*(\d+)[:.)\-]?\s+(.+)$/i);
      const isNewQuestionHeader = !!qHeaderMatch || !!line.match(/^\s*\d+[\s.)\-]/);

      if (isNewQuestionHeader) {
        flushCurrent();
        if (qHeaderMatch) {
          currentQuestion.question_text.push(qHeaderMatch[3].trim());
        } else {
          currentQuestion.question_text.push(line.trim());
        }
      } else {
        if (currentQuestion.choices.length > 0) {
          const lastChoice = currentQuestion.choices[currentQuestion.choices.length - 1];
          lastChoice.text = (lastChoice.text + ' ' + line.trim()).trim();
        } else {
          currentQuestion.question_text.push(line.trim());
        }
      }
    }

    flushCurrent();
    return questions;
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
