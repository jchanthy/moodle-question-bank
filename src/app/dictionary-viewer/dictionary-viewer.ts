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
      <!-- Minimal Top Bar -->
      <header class="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white px-4 py-2 flex items-center justify-between shrink-0 shadow-md">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="text-lg">📖</span>
          <div class="flex items-center gap-2 min-w-0">
            <h1 class="text-base md:text-lg font-black tracking-wide truncate font-kantumruy">{{ currentWord() }}</h1>
            <span class="text-[10px] bg-white/20 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider hidden sm:inline-block">
              KhmerDict Live
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <a *ngIf="rawUrl()" 
             [href]="rawUrl()" 
             target="_blank" 
             rel="noopener noreferrer"
             class="px-2.5 py-1 text-xs font-bold bg-white/15 hover:bg-white/25 rounded-lg transition text-blue-100 hover:text-white flex items-center gap-1 cursor-pointer"
             title="បើកផ្ទាល់ក្នុង KhmerDict.com">
            <span>បើកផ្ទាល់ ↗</span>
          </a>
        </div>
      </header>

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
  rawUrl = signal<string>('');
  safeUrl = signal<SafeResourceUrl | null>(null);

  ngOnInit() {
    // Assign persistent window name so subsequent window.open calls target this same tab
    try {
      window.name = 'khmer_dictionary_tab';
    } catch (e) {}

    // Read route query parameters (?word=...)
    this.route.queryParamMap.subscribe(params => {
      const w = params.get('word');
      if (w) {
        this.loadWord(w);
      }
    });

    // Listen to BroadcastChannel for instant live updates from the main window without reloads
    try {
      this.broadcastChannel = new BroadcastChannel('khmer_dict_sync');
      this.broadcastChannel.onmessage = (event) => {
        if (event.data && event.data.word) {
          this.loadWord(event.data.word);
        }
      };
    } catch (e) {}
  }

  ngOnDestroy() {
    try {
      this.broadcastChannel?.close();
    } catch (e) {}
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
}
