import { Component, signal } from '@angular/core';
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
}
