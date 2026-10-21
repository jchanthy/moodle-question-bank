import { Component, signal, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KhmerSpellCheckService } from './services/khmer-spellcheck.service';
import { RouterOutlet } from '@angular/router';
import { gitCommit } from '../environments/version';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('moodle-question-bank');
  protected readonly gitCommit = gitCommit;
  protected readonly showScrollTop = signal(false);
  protected readonly spellCheckService = inject(KhmerSpellCheckService);

  @HostListener('window:keydown.escape')
  onEscapeKey() {
    if (this.spellCheckService.activeDictDrawer()) {
      this.spellCheckService.closeDictionaryModal();
    }
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    this.showScrollTop.set(scrollPosition > 300);
  }

  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent) {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement.tagName === 'INPUT' && activeElement.getAttribute('type') === 'number') {
      activeElement.blur();
    }
  }

  scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}
