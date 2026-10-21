import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { KhmerSpellCheckService, MptcTerm } from '../services/khmer-spellcheck.service';

@Component({
  selector: 'app-dictionary-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col h-screen w-screen bg-slate-100 overflow-hidden font-kantumruy select-none">
      <!-- Top Navigation Bar -->
      <header class="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white px-4 py-2 flex items-center justify-between shrink-0 shadow-md gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center text-base shrink-0 shadow-xs">
            📖
          </div>
          <div class="flex items-center gap-2 min-w-0">
            <h1 class="text-base md:text-lg font-black tracking-wide truncate font-kantumruy">{{ currentWord() }}</h1>
            <span class="text-[10px] bg-emerald-500/80 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider hidden sm:inline-block">
              KhmerDict Live
            </span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center gap-2 shrink-0">
          <!-- Return to Question Button -->
          <button type="button"
                  (click)="returnToEditor()"
                  class="px-3 py-1.5 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                  title="ត្រឡប់ទៅផ្ទាំងកែសម្រួលសំណួរវិញ">
            <span>⬅</span>
            <span>ត្រឡប់ទៅកែសំណួរ (Back)</span>
          </button>

          <!-- Direct Link to KhmerDict.com -->
          <a *ngIf="rawUrl()" 
             [href]="rawUrl()" 
             target="_blank" 
             rel="noopener noreferrer"
             class="px-2.5 py-1.5 text-xs font-bold bg-white/15 hover:bg-white/25 rounded-xl transition text-blue-100 hover:text-white hidden md:flex items-center gap-1 cursor-pointer"
             title="បើកផ្ទាល់ក្នុង KhmerDict.com">
            <span>បើកផ្ទាល់ ↗</span>
          </a>
        </div>
      </header>

      <!-- Question Context Banner (Ensures user never loses their question) -->
      <div *ngIf="questionText()" class="bg-amber-50/95 border-b border-amber-200/90 px-4 py-1.5 flex items-center justify-between gap-3 shrink-0 shadow-xs">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="text-xs font-black text-amber-900 shrink-0 flex items-center gap-1">
            <span>📌</span> សំណួរដែលកំពុងកែ:
          </span>
          <p class="text-xs text-slate-700 truncate font-medium font-sans" [title]="questionText()">
            {{ questionText() }}
          </p>
        </div>
        <span class="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full shrink-0 hidden sm:inline-block">
          ពាក្យស្វែងរក: {{ currentWord() }}
        </span>
      </div>

      <!-- Official MPTC Technical Glossary Card -->
      <div *ngIf="mptcTerm()" class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 py-2 border-b border-indigo-500/40 shrink-0 shadow-sm animate-in fade-in duration-150">
        <div class="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-[11px] bg-blue-500/30 text-blue-200 border border-blue-400/40 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <span>🇰🇭</span> បច្ចេកសព្ទ ប.គ.ព. MPTC
            </span>
            <span class="text-xs text-amber-300 font-extrabold flex items-center gap-1">
              <span>🇬🇧 English:</span>
              <span class="underline decoration-amber-400/50">{{ mptcTerm()!.english }}</span>
            </span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono">ល.រ {{ mptcTerm()!.no }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 mt-1 flex-wrap">
          <div class="text-xs text-slate-100 flex-1 leading-relaxed select-text font-medium">
            <span class="font-extrabold text-amber-200 text-sm mr-2">{{ mptcTerm()!.khmer }}</span>
            <span>{{ mptcTerm()!.definition }}</span>
          </div>
          <button type="button" 
                  (click)="applyReplacement(mptcTerm()!.khmerVariants[0] || mptcTerm()!.khmer)"
                  class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shrink-0 cursor-pointer shadow-xs active:scale-95 flex items-center gap-1">
            <span>✓ យកពាក្យបច្ចេកទេសនេះ</span>
          </button>
        </div>
      </div>

      <!-- Quick Typo Replacement Banner (Auto-replaces typo in question) -->
      <div *ngIf="typoWord()" class="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-700 text-white px-4 py-2 flex items-center justify-between gap-3 shadow-inner shrink-0 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-sm">⚡</span>
          <div class="flex items-center gap-1.5 text-xs">
            <span class="opacity-80">ពាក្យខុសក្នុងសំណួរ៖</span>
            <span class="font-bold text-rose-200 line-through bg-black/20 px-1.5 py-0.5 rounded">{{ typoWord() }}</span>
            <span>➔</span>
            <span class="opacity-80">ជំនួសដោយ៖</span>
            <span class="font-extrabold text-amber-300 bg-black/20 px-1.5 py-0.5 rounded">{{ currentWord() }}</span>
          </div>
        </div>

        <button type="button" 
                (click)="applyReplacement(currentWord())"
                class="px-3.5 py-1.5 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-extrabold text-xs rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0">
          <span>{{ lastReplaced() === currentWord() ? '✓ បានជំនួសរួច' : '✅ ជំនួសពាក្យនេះចូលសំណួរ (Replace)' }}</span>
        </button>
      </div>

      <!-- Embedded Full KhmerDict Frame -->
      <main class="flex-grow w-full h-full relative bg-white">
        <iframe *ngIf="safeUrl()" 
                [src]="safeUrl()" 
                class="w-full h-full border-0 absolute inset-0" 
                title="KhmerDict Preview">
        </iframe>
      </main>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
  `]
})
export class DictionaryViewerComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);
  private spellCheckService = inject(KhmerSpellCheckService);
  private broadcastChannel: BroadcastChannel | null = null;

  currentWord = signal<string>('');
  typoWord = signal<string>('');
  questionText = signal<string>('');
  rawUrl = signal<string>('');
  safeUrl = signal<SafeResourceUrl | null>(null);
  lastReplaced = signal<string | null>(null);
  mptcTerm = signal<MptcTerm | null>(null);

  ngOnInit() {
    // Assign persistent window name so subsequent window.open calls target this same window
    try {
      window.name = 'khmerdict_window';
    } catch (e) {}

    // Read route query parameters (?word=...&q=...&typo=...)
    this.route.queryParamMap.subscribe(params => {
      const w = params.get('word');
      const q = params.get('q');
      const typo = params.get('typo');
      if (q) {
        this.questionText.set(this.cleanQuestionText(q));
      }
      if (typo) {
        this.typoWord.set(typo.trim());
      }
      if (w) {
        this.loadWord(w);
      }
    });

    // Listen to BroadcastChannel for instant live updates from the main window without reloads
    try {
      this.broadcastChannel = new BroadcastChannel('khmer_dict_sync');
      this.broadcastChannel.onmessage = (event) => {
        if (event.data) {
          if (event.data.question !== undefined) {
            this.questionText.set(this.cleanQuestionText(event.data.question));
          }
          if (event.data.typo !== undefined) {
            this.typoWord.set(event.data.typo ? event.data.typo.trim() : '');
          }
          if (event.data.word) {
            this.loadWord(event.data.word);
          }
        }
      };
    } catch (e) {}
  }

  ngOnDestroy() {
    try {
      this.broadcastChannel?.close();
    } catch (e) {}
  }

  cleanQuestionText(text: string): string {
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  loadWord(word: string) {
    const clean = word.replace(/^[^\u1780-\u17FF\w]+|[^\u1780-\u17FF\w]+$/g, '').trim();
    const finalWord = clean || word;

    // Check official MPTC Technical Glossary first
    const mptc = this.spellCheckService.findMptcTerm(finalWord);
    this.mptcTerm.set(mptc);

    let lookupWord = finalWord;
    if (mptc && mptc.english && mptc.english.toLowerCase() === finalWord.toLowerCase()) {
      // User searched English term, switch to official Khmer technical term
      lookupWord = mptc.khmerVariants[0] || mptc.khmer;
      this.currentWord.set(lookupWord);
    } else {
      this.currentWord.set(finalWord);
    }

    const directUrl = `https://khmerdict.com/${encodeURIComponent(lookupWord)}`;
    this.rawUrl.set(directUrl);
    this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(directUrl));
    try {
      document.title = `📖 ${finalWord} - វចនានុក្រមខ្មែរ`;
    } catch (e) {}
  }

  applyReplacement(replacement: string) {
    if (!replacement) return;
    const typo = this.typoWord() || this.currentWord();
    this.spellCheckService.sendReplacement(typo, replacement);
    this.lastReplaced.set(replacement);
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
      }
    } catch (e) {}
  }

  returnToEditor() {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        return;
      }
    } catch (e) {}
    try {
      window.close();
    } catch (e) {}
  }
}
