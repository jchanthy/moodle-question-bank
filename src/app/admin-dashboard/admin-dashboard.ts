import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

interface Question {
  id: string;
  name: string;
  question_text: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  created_at: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css'
})
export class AdminDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);

  pendingQuestions = signal<Question[]>([]);
  loading = signal(true);

  constructor() {
    effect(() => {
      if (this.supabaseService.currentUserRole() === 'admin') {
        this.loadPendingQuestions();
      }
    });
  }

  ngOnInit() {
    this.loadPendingQuestions();
  }

  async loadPendingQuestions() {
    this.loading.set(true);
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true });

    if (!error) {
      this.pendingQuestions.set(data as Question[]);
    }
    this.loading.set(false);
  }

  async updateStatus(id: string, status: 'approved' | 'rejected') {
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ status })
      .eq('id', id);

    if (!error) {
      this.loadPendingQuestions();
    }
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }
}
