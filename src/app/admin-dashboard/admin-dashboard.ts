import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterModule } from '@angular/router';

interface Question {
  id: string;
  name: string;
  question_text: string;
  qtype: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  version: number;
  metadata: any;
  created_at: string;
}

interface TypeCount {
  type: string;
  label: string;
  count: number;
  icon: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css'
})
export class AdminDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);

  pendingQuestions = signal<Question[]>([]);
  loading = signal(true);
  questionTypeCounts = signal<TypeCount[]>([]);
  totalQuestions = signal(0);

  typeLabels: Record<string, { label: string; icon: string }> = {
    'multichoice': { label: 'Multiple Choice', icon: '🔘' },
    'truefalse': { label: 'True/False', icon: '✅' },
    'shortanswer': { label: 'Short Answer', icon: '✏️' },
    'numerical': { label: 'Numerical', icon: '🔢' },
    'essay': { label: 'Essay', icon: '📝' },
    'match': { label: 'Matching', icon: '🔗' },
    'calculated': { label: 'Calculated', icon: '🧮' },
    'calculatedmulti': { label: 'Calc. Multichoice', icon: '🧮' },
    'calculatedsimple': { label: 'Calc. Simple', icon: '🧮' },
    'ddwtos': { label: 'Drag into Text', icon: '📋' },
    'ddimageortext': { label: 'Drag onto Image', icon: '🖼️' },
    'ddmarker': { label: 'Drag Matching', icon: '📌' },
    'ordering': { label: 'Ordering', icon: '↕️' },
    'coderunner': { label: 'CodeRunner', icon: '💻' },
  };

  constructor() {
    effect(() => {
      if (this.supabaseService.currentUserRole() === 'admin') {
        this.loadPendingQuestions();
        this.loadQuestionTypeCounts();
      }
    });
  }

  ngOnInit() {
    this.loadPendingQuestions();
    this.loadQuestionTypeCounts();
  }

  async loadPendingQuestions() {
    this.loading.set(true);
    console.log('Admin: Fetching pending questions...');
    
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('status', 'pending_review')
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Admin: Error fetching questions:', error);
    } else {
      console.log('Admin: Questions received:', data);
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

  async loadQuestionTypeCounts() {
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('qtype')
      .is('deleted_at', null);

    if (error || !data) return;

    this.totalQuestions.set(data.length);

    const countMap = new Map<string, number>();
    data.forEach((q: any) => {
      const type = q.qtype || 'unknown';
      countMap.set(type, (countMap.get(type) || 0) + 1);
    });

    const counts: TypeCount[] = Array.from(countMap.entries())
      .map(([type, count]) => ({
        type,
        label: this.typeLabels[type]?.label || type,
        count,
        icon: this.typeLabels[type]?.icon || '❓',
      }))
      .sort((a, b) => b.count - a.count);

    this.questionTypeCounts.set(counts);
  }
}
