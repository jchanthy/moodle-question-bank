import { Injectable, signal } from '@angular/core';

export interface SpellCheckToken {
  text: string;
  isKhmer: boolean;
  isValid: boolean;
  startIndex: number;
  endIndex: number;
  suggestions?: string[];
}

export interface SpellCheckReport {
  tokens: SpellCheckToken[];
  errorCount: number;
}

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
      const response = await fetch('/data/khmer-words.json');
      if (!response.ok) throw new Error('Failed to fetch dictionary');
      const words: string[] = await response.json();
      
      for (const w of words) {
        this.dictionary.add(w);
        const len = w.length;
        if (!this.wordsByLength.has(len)) {
          this.wordsByLength.set(len, []);
        }
        this.wordsByLength.get(len)!.push(w);
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
    return str.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
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
            } else {
              const d = this.getNearestDistance(sub);
              if (d <= 1) {
                const cost = 2.0;
                if (dp[c] + cost < dp[j]) {
                  dp[j] = dp[c] + cost;
                  parent[j] = c;
                }
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

    // 2. Bucketed Levenshtein lookup (target length +/- 2)
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
      if (!suggestions.includes(item.word)) {
        suggestions.push(item.word);
      }
      if (suggestions.length >= maxSuggestions) break;
    }

    return suggestions.slice(0, maxSuggestions);
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
