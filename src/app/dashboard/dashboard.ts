import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

interface Question {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  created_at: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);

  // New question form (Teacher)
  newQuestionTitle = signal('');
  newQuestionContent = signal('');

  // Questions lists
  myQuestions = signal<Question[]>([]);
  pendingQuestions = signal<Question[]>([]);

  constructor() {
    // Reload questions if role changes (e.g. after login role fetch completes)
    effect(() => {
      const role = this.supabaseService.currentUserRole();
      if (role) {
        this.loadQuestions();
      }
    });
  }

  ngOnInit() {
    this.loadQuestions();
  }

  async loadQuestions() {
    const role = this.supabaseService.currentUserRole();
    const user = this.supabaseService.currentUser();
    
    if (!user) return;

    if (role === 'teacher' || role === 'admin') {
       // Teachers see their own questions
       const { data: myData } = await this.supabaseService.db
        .from('questions')
        .select('*')
        .eq('created_by', user.id);
       this.myQuestions.set(myData as Question[] || []);
    }

    if (role === 'admin') {
       // Admins see all pending questions
       const { data: pendingData } = await this.supabaseService.db
        .from('questions')
        .select('*')
        .eq('status', 'pending_review');
       this.pendingQuestions.set(pendingData as Question[] || []);
    }
  }

  async addQuestion() {
    if (!this.newQuestionTitle() || !this.newQuestionContent()) return;

    const { error } = await this.supabaseService.db.from('questions').insert({
      title: this.newQuestionTitle(),
      content: this.newQuestionContent(),
      status: 'pending_review' // Skipping draft for now to test review process
    });

    if (!error) {
      this.newQuestionTitle.set('');
      this.newQuestionContent.set('');
      this.loadQuestions();
    } else {
      console.error('Error adding question:', error);
    }
  }

  async approveQuestion(id: string) {
    const { error } = await this.supabaseService.db.from('questions')
      .update({ status: 'approved' })
      .eq('id', id);

    if (!error) {
      this.loadQuestions();
    } else {
      console.error('Error approving question:', error);
    }
  }

  async rejectQuestion(id: string) {
    const { error } = await this.supabaseService.db.from('questions')
      .update({ status: 'rejected' })
      .eq('id', id);

    if (!error) {
      this.loadQuestions();
    }
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }
}
