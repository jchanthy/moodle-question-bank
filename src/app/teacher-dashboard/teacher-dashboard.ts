import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterModule } from '@angular/router';

interface Question {
  id: string;
  name: string;
  question_text: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  created_at: string;
}

@Component({
  selector: 'app-teacher-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './teacher-dashboard.html',
  styleUrl: './teacher-dashboard.css'
})
export class TeacherDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);

  myQuestions = signal<Question[]>([]);
  loading = signal(true);

  constructor() {
    effect(() => {
      if (this.supabaseService.currentUser()) {
        this.loadMyQuestions();
      }
    });
  }

  ngOnInit() {
    this.loadMyQuestions();
  }

  async loadMyQuestions() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    this.loading.set(true);
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (!error) {
      this.myQuestions.set(data as Question[]);
    }
    this.loading.set(false);
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }
}
