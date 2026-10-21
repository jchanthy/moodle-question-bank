import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-dictionary-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col h-screen w-screen bg-slate-100 overflow-hidden font-kantumruy select-none">
      <!-- Top Navigation Bar -->
      <header class="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0 shadow-md gap-3">
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
      <div *ngIf="questionText()" class="bg-amber-50/95 border-b border-amber-200/90 px-4 py-2 flex items-center justify-between gap-3 shrink-0 shadow-xs">
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
  private broadcastChannel: BroadcastChannel | null = null;

  currentWord = signal<string>('');
  questionText = signal<string>('');
  rawUrl = signal<string>('');
  safeUrl = signal<SafeResourceUrl | null>(null);

  ngOnInit() {
    // Assign persistent window name so subsequent window.open calls target this same tab
    try {
      window.name = 'khmerdict_tab';
    } catch (e) {}

    // Read route query parameters (?word=...&q=...)
    this.route.queryParamMap.subscribe(params => {
      const w = params.get('word');
      const q = params.get('q');
      if (q) {
        this.questionText.set(this.cleanQuestionText(q));
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
    this.currentWord.set(finalWord);
    const directUrl = `https://khmerdict.com/${encodeURIComponent(finalWord)}`;
    this.rawUrl.set(directUrl);
    this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(directUrl));
    try {
      document.title = `📖 ${finalWord} - វចនានុក្រមខ្មែរ`;
    } catch (e) {}
  }

  returnToEditor() {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        return;
      }
    } catch (e) {}
    // If opener cannot be directly focused, attempt history back or notification
    try {
      window.close();
    } catch (e) {}
  }
}
