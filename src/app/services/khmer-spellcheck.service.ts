import { Injectable, signal } from '@angular/core';

export interface SpellCheckToken {
  text: string;
  isKhmer: boolean;
  isValid: boolean;
  startIndex: number;
  endIndex: number;
  suggestions?: string[];
  primarySuggestion?: string | null;
}

export interface SpellCheckReport {
  tokens: SpellCheckToken[];
  errorCount: number;
}

const COMMON_2_CONSONANT_WORDS = new Set([
  'កក', 'ករ', 'កល', 'ជន', 'ជល', 'ដក', 'ដង', 'ដប', 'ថត', 'ថយ',
  'ទស', 'បទ', 'បរ', 'ផល', 'ពល', 'ភព', 'មក', 'យក', 'យស', 'រក',
  'រង', 'រថ', 'រស', 'សព', 'ហង', 'អក', 'អរ'
]);

@Injectable({
  providedIn: 'root'
})
export class KhmerSpellCheckService {
  private dictionary = new Set<string>();
  private customWords = new Set<string>();
  private ignoredWords = new Set<string>();
  
  // Fast length-indexed word buckets for sub-millisecond typo detection
  private wordsByLength = new Map<number, string[]>();

  // High-performance memoization cache (0ms lookup for repeated checks)
  private reportCache = new Map<string, SpellCheckReport>();
  private suggestionCache = new Map<string, string[]>();
  private readonly MAX_CACHE_SIZE = 300;

  isLoaded = signal(false);
  isLoading = signal(false);

  constructor() {
    this.loadCustomDictionary();
    this.loadDictionary();
  }

  private loadCustomDictionary() {
    try {
      const stored = localStorage.getItem('khmer_custom_dictionary');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          parsed.forEach(w => this.customWords.add(w));
        }
      }
    } catch (e) {
      console.warn('Failed to load custom dictionary from localStorage:', e);
    }
  }

  async loadDictionary(): Promise<void> {
    if (this.isLoaded() || this.isLoading()) return;
    this.isLoading.set(true);

    try {
      let response: Response;
      try {
        response = await fetch('data/khmer-words.json');
        if (!response.ok) {
          response = await fetch('/data/khmer-words.json');
        }
      } catch {
        response = await fetch('/data/khmer-words.json');
      }
      if (!response.ok) throw new Error(`Failed to fetch dictionary: ${response.status}`);
      const words: string[] = await response.json();
      
      const defaultTechTerms = [
        'វីគីភីឌា', 'វិគីភីឌា', 'វីគី', 'វិគី',
        'ជាក់ស្តែង', 'បញ្ញាសិប្បនិម្មិត', 'ម៉ូឌែល',
        'វេបសាយ', 'វេបសាយត៍', 'អ៊ីនធឺណេត',
        'ហាដវែរ', 'សូហ្វវែរ', 'អនឡាញ', 'អុហ្វឡាញ',
        'សាយប័រ', 'សន្តិសុខសាយប័រ', 'កូដឌីង', 'ប្រូក្រាម',
        'ប្រូក្រាមីង', 'ដេតាបេស', 'ដាតាបេស',
        'បណ្តាញសង្គម', 'បណ្ដាញសង្គម', 'ក្បួនដោះស្រាយ', 'ក្បួនវិធី',
        'ម៉ាស៊ីនរៀន', 'ការរៀនម៉ាស៊ីន', 'ស្មាតហ្វូន', 'ទូរស័ព្ទឆ្លាតវៃ',
        'តំណភ្ជាប់', 'ប្រភពបើកចំហ', 'ផ្ទាំងគ្រប់គ្រង', 'ពហុជ្រើសរើស',
        'សឺវើរ', 'អាល់ហ្គោរីត', 'អាល់ហ្គោរីធឹម', 'ឆាតបូត',
        'ប្រព័ន្ធប្រតិបត្តិការ', 'មីក្រូសូហ្វ', 'យូធូប', 'ហ្វេសប៊ុក',
        'កម្មវិធីរុករក', 'ម៉ាស៊ីនស្វែងរក', 'កុំព្យូទ័រយួរដៃ', 'ថាប្លែត',
        'អ៊ីនធឺហ្វេស', 'ដានីឡា', 'អ៊ិនធឺណិត', 'អ៊ិនធឺណែត',
        // Encryption, IT, and Modern Morphology terms
        'កូដនីយកម្ម', 'វិកូដនីយកម្ម', 'នីយកម្ម', 'នីយ', 'នីយភាព', 'អ៊ីវ៉ង់', 'អ៊ីវង់',
        'កូដនីយកម្មទិន្នន័យ', 'កូដសម្ងាត់', 'គន្លឹះសម្ងាត់', 'ហត្ថលេខាឌីជីថល',
        'ប្លុកឆេន', 'ពិធីការ', 'សុវត្ថិភាពព័ត៌មាន', 'រចនាសម្ព័ន្ធទិន្នន័យ',
        'វិស្វកម្មទិន្នន័យ', 'វិទ្យាសាស្ត្រទិន្នន័យ', 'វិស្វកម្មឃ្លាបញ្ជា',
        'ស្វ័យប្រវត្តិនីយកម្ម', 'ឌីជីថលនីយកម្ម', 'ទំនើបនីយកម្ម',
        'ស្តង់ដារនីយកម្ម', 'ប្រក្រតីនីយកម្ម', 'សកលភាវូបនីយកម្ម',
        'និម្មិតនីយកម្ម', 'ឯកជននីយកម្ម', 'កណ្តាលនីយកម្ម', 'វិមជ្ឈការនីយកម្ម'
      ];
      for (const t of defaultTechTerms) {
        words.push(t);
      }

      const addWord = (w: string) => {
        if (!w || this.dictionary.has(w)) return;
        this.dictionary.add(w);
        const len = w.length;
        if (!this.wordsByLength.has(len)) {
          this.wordsByLength.set(len, []);
        }
        this.wordsByLength.get(len)!.push(w);
      };

      for (const w of words) {
        addWord(w);
        // Orthographic/homoglyph equivalence: ផ + ្ដ (coeng DA U+178A) and ផ + ្ត (coeng TA U+178F)
        // e.g., ផ្ដល់ (Chuon Nath dictionary) <-> ផ្តល់ (standard modern keyboard typing)
        if (w.includes('\u1795\u17D2\u178A')) {
          addWord(w.replace(/\u1795\u17D2\u178A/g, '\u1795\u17D2\u178F'));
        } else if (w.includes('\u1795\u17D2\u178F')) {
          addWord(w.replace(/\u1795\u17D2\u178F/g, '\u1795\u17D2\u178A'));
        }
      }
      this.isLoaded.set(true);
    } catch (err) {
      console.error('Error loading Khmer dictionary:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  addToCustomDictionary(word: string) {
    const clean = this.cleanKhmer(word);
    if (!clean) return;
    this.customWords.add(clean);
    this.reportCache.clear();
    this.suggestionCache.clear();
    try {
      localStorage.setItem('khmer_custom_dictionary', JSON.stringify(Array.from(this.customWords)));
    } catch (e) {
      console.warn('Failed to save custom dictionary:', e);
    }
  }

  ignoreWord(word: string) {
    const clean = this.cleanKhmer(word);
    if (clean) {
      this.ignoredWords.add(clean);
      this.reportCache.clear();
    }
  }

  /**
   * Checks if a word is valid.
   * Handles:
   * 1. Direct dictionary matches
   * 2. Repetition signs 'ៗ' (e.g. ឆាប់ៗ, ឆាប់ៗៗ)
   * 3. Single consonants in continuous text
   */
  isWordValid(word: string, isIsolated: boolean = false): boolean {
    const clean = this.cleanKhmer(word);
    if (!clean) return true;
    if (this.customWords.has(clean) || this.ignoredWords.has(clean)) return true;

    // Single consonants (ក, ខ, ..., អ) are almost never standalone words inside continuous text
    if (!isIsolated && clean.length === 1 && /[\u1780-\u17A2]/.test(clean)) {
      return false;
    }

    if (this.dictionary.has(clean)) return true;

    // Homoglyph equivalence fallback: ផ + ្ដ <-> ផ + ្ត
    if (clean.includes('\u1795\u17D2\u178A') && this.dictionary.has(clean.replace(/\u1795\u17D2\u178A/g, '\u1795\u17D2\u178F'))) return true;
    if (clean.includes('\u1795\u17D2\u178F') && this.dictionary.has(clean.replace(/\u1795\u17D2\u178F/g, '\u1795\u17D2\u178A'))) return true;

    // Morphological suffix: -នីយកម្ម (-ization / -fication) e.g. កូដនីយកម្ម, ទំនើបនីយកម្ម
    if (clean.endsWith('នីយកម្ម') && clean.length > 7) {
      const base = clean.slice(0, -7);
      if (this.dictionary.has(base) || this.customWords.has(base) || this.isWordValid(base, true)) {
        return true;
      }
    }

    // Morphological suffix: -នីយភាព (-bility)
    if (clean.endsWith('នីយភាព') && clean.length > 6) {
      const base = clean.slice(0, -6);
      if (this.dictionary.has(base) || this.customWords.has(base) || this.isWordValid(base, true)) {
        return true;
      }
    }

    // Morphological prefix: វិ- (e.g. វិកូដនីយកម្ម = Decryption)
    if (clean.startsWith('វិ') && clean.length > 2) {
      const base = clean.slice(2);
      if (this.dictionary.has(base) || this.customWords.has(base) || this.isWordValid(base, true)) {
        return true;
      }
    }

    // Support Khmer repetition sign 'ៗ' (U+17D7)
    // Rules:
    // 1. Multiple repetition signs (e.g. ឆាប់ៗៗ, ៗៗ) are grammatically incorrect in Khmer orthography
    // 2. Exactly one 'ៗ' at the end of a valid word (e.g. ឆាប់ៗ) is valid
    if (clean.includes('\u17D7')) {
      if (/\u17D7{2,}/.test(clean)) {
        return false;
      }
      if (clean === '\u17D7' || !clean.endsWith('\u17D7')) {
        return false;
      }
      const baseWord = clean.slice(0, -1);
      if (baseWord && (this.dictionary.has(baseWord) || this.customWords.has(baseWord))) {
        return true;
      }
      return false;
    }

    return false;
  }

  cleanKhmer(str: string): string {
    if (!str) return '';
    return str
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Canonical Khmer Unicode order: diacritics (triisap/muusikatoan) before vowel signs
      .replace(/([\u17B6-\u17C5])([\u17C9\u17CA])/g, (m, v, d) => d + v)
      .trim();
  }

  private getClusterBoundaries(str: string): number[] {
    const boundaries: number[] = [0];
    let i = 0;
    while (i < str.length) {
      i++;
      while (i < str.length) {
        const ch = str[i];
        if (ch === '\u17D2') {
          i += 2;
        } else if (/[\u17B6-\u17D3\u17DD]/.test(ch)) {
          i++;
        } else {
          break;
        }
      }
      boundaries.push(Math.min(i, str.length));
    }
    return Array.from(new Set(boundaries)).sort((a, b) => a - b);
  }

  /**
   * Ultra-fast nearest dictionary candidate check using indexed buckets
   */
  private getNearestDistance(candidate: string): number {
    const len = candidate.length;
    let minD = 99;
    const candidates = [
      ...(this.wordsByLength.get(len) || []),
      ...(this.wordsByLength.get(len - 1) || []),
      ...(this.wordsByLength.get(len + 1) || [])
    ];

    for (const w of candidates) {
      if (w[0] === candidate[0]) {
        const d = this.levenshtein(candidate, w);
        if (d < minD) minD = d;
        if (minD <= 1) return minD;
      }
    }
    return minD;
  }

  private isFastTypoCandidate(sub: string): boolean {
    if (sub.includes('្ត') || sub.includes('្ដ')) {
      const swapped = sub.includes('្ត')
        ? sub.replace(/្ត/g, '្ដ')
        : sub.replace(/្ដ/g, '្ត');
      if (this.isWordValid(swapped, false)) return true;
    }
    if (sub.includes('\u17CB') || sub.includes('\u17C9')) {
      const swapped = sub.includes('\u17CB')
        ? sub.replace('\u17CB', '\u17C9')
        : sub.replace('\u17C9', '\u17CB');
      if (this.isWordValid(swapped, false)) return true;
    }
    if (sub.includes('ំ')) {
      const swapped = sub.replace(/([ក-អ])ំ([ក-អ])/g, (m, c1, c2) => c1 + 'ម្' + c2);
      if (this.isWordValid(swapped, false)) return true;
    }
    if (sub.includes('្ត្រ') || sub.includes('្រ្ត')) {
      const swapped = sub.includes('្ត្រ')
        ? sub.replace(/្ត្រ/g, '្រ្ត')
        : sub.replace(/្រ្ត/g, '្ត្រ');
      if (this.isWordValid(swapped, false)) return true;
    }
    return false;
  }

  /**
   * Segments and analyzes a block of text into tokens with high speed (<5ms).
   */
  checkText(text: string): SpellCheckReport {
    if (!text || !this.isLoaded()) {
      return { 
        tokens: [{ text: text || '', isKhmer: false, isValid: true, startIndex: 0, endIndex: text?.length || 0 }], 
        errorCount: 0 
      };
    }

    if (this.reportCache.has(text)) {
      return this.reportCache.get(text)!;
    }

    // Split into Non-Word vs continuous Khmer word blocks
    // Split into Non-Word vs continuous Khmer word blocks
    // Khmer word letters: \u1780-\u17D3, \u17D7 (ៗ), and \u17DD (excludes punctuation like ។ ៖ and digits)
    const blocks: { text: string; isKhmer: boolean; startIndex: number; endIndex: number }[] = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      const isWordChar = /[\u1780-\u17D3\u17D7\u17DD]/.test(ch);

      if (!isWordChar) {
        let nonWord = '';
        const start = i;
        while (i < text.length && !/[\u1780-\u17D3\u17D7\u17DD]/.test(text[i])) {
          nonWord += text[i];
          i++;
        }
        blocks.push({ text: nonWord, isKhmer: false, startIndex: start, endIndex: i });
      } else {
        let wordBlock = '';
        const start = i;
        while (i < text.length && /[\u1780-\u17D3\u17D7\u17DD]/.test(text[i])) {
          wordBlock += text[i];
          i++;
        }
        blocks.push({ text: wordBlock, isKhmer: true, startIndex: start, endIndex: i });
      }
    }

    const finalTokens: SpellCheckToken[] = [];
    let errorCount = 0;

    for (const block of blocks) {
      if (!block.isKhmer) {
        finalTokens.push({
          text: block.text,
          isKhmer: false,
          isValid: true,
          startIndex: block.startIndex,
          endIndex: block.endIndex
        });
        continue;
      }

      const bText = block.text;
      const b = this.getClusterBoundaries(bText);
      const n = b.length;

      const dp = new Array<number>(n).fill(Infinity);
      const parent = new Array<number>(n).fill(0);
      dp[0] = 0;

      for (let c = 0; c < n; c++) {
        if (dp[c] === Infinity) continue;

        // 1. Try valid dictionary words (up to 8 clusters)
        for (let j = c + 1; j < Math.min(n, c + 9); j++) {
          const sub = bText.substring(b[c], b[j]);
          if (this.isWordValid(sub, bText.length === sub.length)) {
            const cost = 1 / ((j - c) * (j - c));
            if (dp[c] + cost < dp[j]) {
              dp[j] = dp[c] + cost;
              parent[j] = c;
            }
          }
        }

        // 2. Fast candidate typo check using indexed bucket lookup (dist <= 1)
        for (let j = c + 2; j < Math.min(n, c + 9); j++) {
          const sub = bText.substring(b[c], b[j]);
          if (!this.isWordValid(sub, false)) {
            // Check multi-lekhto (e.g. ឆាប់ៗៗ -> base word ឆាប់ is valid)
            const multiLekhto = sub.match(/^(.+?)(\u17D7{2,})$/);
            if (multiLekhto && (this.dictionary.has(multiLekhto[1]) || this.customWords.has(multiLekhto[1]))) {
              const cost = 1.4;
              if (dp[c] + cost < dp[j]) {
                dp[j] = dp[c] + cost;
                parent[j] = c;
              }
              continue;
            }

            // Also check duplicated trailing consonant (e.g. យើងង -> យើង)
            const doubleMatch = sub.match(/^(.+)([\u1780-\u17A2])\2$/);
            if (doubleMatch && this.isWordValid(doubleMatch[1] + doubleMatch[2], false)) {
              const cost = 1.8;
              if (dp[c] + cost < dp[j]) {
                dp[j] = dp[c] + cost;
                parent[j] = c;
              }
            } else if (this.isFastTypoCandidate(sub)) {
              const cost = 2.0;
              if (dp[c] + cost < dp[j]) {
                dp[j] = dp[c] + cost;
                parent[j] = c;
              }
            }
          }
        }

        // 3. Fallback: single cluster progression
        const fallbackCost = 15;
        if (c + 1 < n && dp[c] + fallbackCost < dp[c + 1]) {
          dp[c + 1] = dp[c] + fallbackCost;
          parent[c + 1] = c;
        }
      }

      // Reconstruct segment path
      const blockTokens: SpellCheckToken[] = [];
      let curr = n - 1;
      while (curr > 0) {
        const prev = parent[curr];
        const sub = bText.substring(b[prev], b[curr]);
        const isValid = this.isWordValid(sub, bText.length === sub.length);
        blockTokens.unshift({
          text: sub,
          isKhmer: true,
          isValid,
          startIndex: block.startIndex + b[prev],
          endIndex: block.startIndex + b[curr]
        });
        curr = prev;
      }

      // Merge adjacent invalid tokens into single error entity
      for (const t of blockTokens) {
        const last = finalTokens[finalTokens.length - 1];
        if (last && last.isKhmer && !last.isValid && !t.isValid) {
          last.text += t.text;
          last.endIndex = t.endIndex;
        } else {
          if (!t.isValid) errorCount++;
          finalTokens.push(t);
        }
      }
    }

    const report: SpellCheckReport = { tokens: finalTokens, errorCount };
    if (this.reportCache.size >= this.MAX_CACHE_SIZE) {
      this.reportCache.clear();
    }
    this.reportCache.set(text, report);
    return report;
  }

  /**
   * Generates spelling correction suggestions in < 15ms.
   */
  getSuggestions(misspelledWord: string, maxSuggestions = 5): string[] {
    const cleanTarget = this.cleanKhmer(misspelledWord);
    if (!cleanTarget || !this.isLoaded()) return [];

    const cacheKey = `${cleanTarget}_${maxSuggestions}`;
    const cached = this.suggestionCache.get(cacheKey);
    if (cached) return cached;

    const suggestions: string[] = [];

    // 1. Multiple ៗ check (e.g. ឆាប់ៗៗ -> suggests ឆាប់ៗ, ឆាប់)
    if (/\u17D7{2,}$/.test(cleanTarget)) {
      const singleRepetition = cleanTarget.replace(/\u17D7+$/, '\u17D7');
      if (this.isWordValid(singleRepetition, true)) {
        suggestions.push(singleRepetition);
      }
      const baseOnly = cleanTarget.replace(/\u17D7+$/, '');
      if (this.isWordValid(baseOnly, true) && !suggestions.includes(baseOnly)) {
        suggestions.push(baseOnly);
      }
    }

    // 2. Check double consonant removal first (e.g. យើងង -> យើង)
    const match = cleanTarget.match(/^(.+)([\u1780-\u17A2])\2$/);
    if (match) {
      const reduced = match[1] + match[2];
      if (this.dictionary.has(reduced) || this.customWords.has(reduced)) {
        if (!suggestions.includes(reduced)) {
          suggestions.push(reduced);
        }
      }
    }

    // 3. Khmer Orthographic & Phonetic Rules (High-Priority Direct Matches)
    // Rule A: Coeng Ta <-> Coeng Da swap (\u17D2\u178F <-> \u17D2\u178A), e.g. ប្តី -> ប្ដី, កណ្តាល -> កណ្ដាល, ផ្តើម -> ផ្ដើម
    if (cleanTarget.includes('\u17D2\u178F') || cleanTarget.includes('\u17D2\u178A')) {
      const toDa = cleanTarget.replace(/\u17D2\u178F/g, '\u17D2\u178A');
      if (this.isWordValid(toDa, true) && !suggestions.includes(toDa)) suggestions.push(toDa);
      const toTa = cleanTarget.replace(/\u17D2\u178A/g, '\u17D2\u178F');
      if (this.isWordValid(toTa, true) && !suggestions.includes(toTa)) suggestions.push(toTa);
    }

    // Rule B: Nikhahit (\u17C6) <-> Consonant + Mo + Coeng (\u1798\u17D2), e.g. កំសត់ -> កម្សត់, កំសាន្ត -> កម្សាន្ត, កំរិត -> កម្រិត
    if (cleanTarget.includes('\u17C6')) {
      const withMoCoeng = cleanTarget.replace(/([\u1780-\u17A2])\u17C6([\u1780-\u17A2])/g, (m, c1, c2) => c1 + '\u1798\u17D2' + c2);
      if (this.isWordValid(withMoCoeng, true) && !suggestions.includes(withMoCoeng)) suggestions.push(withMoCoeng);
    }

    // Rule C: Coeng transposition (e.g. ស្រ្ត <-> ស្ត្រ)
    if (cleanTarget.includes('\u17D2\u178F\u17D2\u179A') || cleanTarget.includes('\u17D2\u179A\u17D2\u178F')) {
      const t1 = cleanTarget.replace(/\u17D2\u178F\u17D2\u179A/g, '\u17D2\u179A\u17D2\u178F');
      if (this.isWordValid(t1, true) && !suggestions.includes(t1)) suggestions.push(t1);
      const t2 = cleanTarget.replace(/\u17D2\u179A\u17D2\u178F/g, '\u17D2\u178F\u17D2\u179A');
      if (this.isWordValid(t2, true) && !suggestions.includes(t2)) suggestions.push(t2);
    }

    // Rule D: Subscript / Keyboard confusion (e.g. ក្ដ <-> ត្ត, as in ទក្ដ -> ទត្ត)
    if (cleanTarget.includes('\u1780\u17D2\u178A')) {
      const s1 = cleanTarget.replace(/\u1780\u17D2\u178A/g, '\u178F\u17D2\u178F');
      if (this.isWordValid(s1, true) && !suggestions.includes(s1)) suggestions.push(s1);
    }

    // Rule E: Muusikatoan <-> Bantoc swap (\u17C9 <-> \u17CB, b vs Shift+b on keyboard, e.g. វ់ង់ -> វ៉ង់)
    if (cleanTarget.includes('\u17CB')) {
      const toM = cleanTarget.replace('\u17CB', '\u17C9');
      if (this.isWordValid(toM, true) && toM !== cleanTarget && !suggestions.includes(toM)) suggestions.push(toM);
    }
    if (cleanTarget.includes('\u17C9')) {
      const toB = cleanTarget.replace('\u17C9', '\u17CB');
      if (this.isWordValid(toB, true) && toB !== cleanTarget && !suggestions.includes(toB)) suggestions.push(toB);
    }

    // Only run heavy Levenshtein if high-priority orthographic rules did not fill maxSuggestions
    if (suggestions.length < maxSuggestions) {
      const targetLen = cleanTarget.length;
      const candidates = [
        ...(this.wordsByLength.get(targetLen) || []),
        ...(this.wordsByLength.get(targetLen - 1) || []),
        ...(this.wordsByLength.get(targetLen + 1) || []),
        ...(this.wordsByLength.get(targetLen - 2) || []),
        ...(this.wordsByLength.get(targetLen + 2) || [])
      ];

      const scored: { word: string; dist: number }[] = [];
      for (const w of candidates) {
        // Never suggest the identical string as a correction for itself
        if (w === cleanTarget) continue;
        // If typo is an isolated single consonant, do not suggest other isolated single consonants
        if (cleanTarget.length === 1 && w.length === 1) continue;

        // Filter out obscure 2-consonant non-words (e.g. ងន, វន, វក, វណ, វយ, កញ, ឆវ)
        if (w.length === 2 && /^[\u1780-\u17A2]{2}$/.test(w) && !COMMON_2_CONSONANT_WORDS.has(w)) {
          continue;
        }

        // Prioritize words with same initial consonant
        if (w[0] === cleanTarget[0]) {
          const dist = this.levenshtein(cleanTarget, w);
          if (dist <= 2) {
            scored.push({ word: w, dist });
          }
        }
      }

      scored.sort((a, b) => a.dist - b.dist);
      for (const item of scored) {
        if (item.word !== cleanTarget && !suggestions.includes(item.word)) {
          suggestions.push(item.word);
        }
        if (suggestions.length >= maxSuggestions) break;
      }
    }

    const result = suggestions.filter(s => s !== cleanTarget && (cleanTarget.length > 1 || s.length > 1)).slice(0, maxSuggestions);
    if (this.suggestionCache.size > 2000) {
      this.suggestionCache.clear();
    }
    this.suggestionCache.set(cacheKey, result);
    return result;
  }

  private levenshtein(a: string, b: string): number {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    const matrix: number[][] = [];
    for (let i = 0; i <= al; i++) matrix[i] = [i];
    for (let j = 0; j <= bl; j++) matrix[0][j] = j;

    for (let i = 1; i <= al; i++) {
      for (let j = 1; j <= bl; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[al][bl];
  }
}
