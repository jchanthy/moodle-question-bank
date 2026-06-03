import { Component, signal, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { gitCommit } from '../environments/version';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('moodle-question-bank');
  protected readonly gitCommit = gitCommit;
  protected readonly showScrollTop = signal(false);

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
