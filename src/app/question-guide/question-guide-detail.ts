import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { SupabaseService } from '../services/supabase.service';
import { QUESTION_GUIDE_DETAILS, QUESTION_GUIDE_ORDER } from './question-guide-data';

@Component({
  selector: 'app-question-guide-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './question-guide-detail.html'
})
export class QuestionGuideDetailComponent {
  private route = inject(ActivatedRoute);
  supabaseService = inject(SupabaseService);

  private typeParam = toSignal(
    this.route.paramMap.pipe(map(p => p.get('type') || '')),
    { initialValue: this.route.snapshot.paramMap.get('type') || '' }
  );

  all = QUESTION_GUIDE_ORDER;

  meta = computed(() => this.all.find(t => t.type === this.typeParam()) || null);
  detail = computed(() => QUESTION_GUIDE_DETAILS[this.typeParam()] || null);

  private index = computed(() => this.all.findIndex(t => t.type === this.typeParam()));
  prev = computed(() => (this.index() > 0 ? this.all[this.index() - 1] : null));
  next = computed(() => (this.index() >= 0 && this.index() < this.all.length - 1 ? this.all[this.index() + 1] : null));

  get isAdmin(): boolean {
    return this.supabaseService.currentUserRole() === 'admin';
  }
}
