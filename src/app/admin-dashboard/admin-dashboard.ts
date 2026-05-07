import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterModule } from '@angular/router';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DrawerModule } from 'primeng/drawer';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

interface Question {
  id: string;
  name: string;
  question_text: string;
  qtype: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  version: number;
  metadata: any;
  created_at: string;
  updated_at?: string;
  created_by: string;
  category_id: string | null;
}

interface Teacher {
  id: string;
  name: string;
}

interface TypeCount {
  type: string;
  label: string;
  count: number;
  icon: string;
}

interface Category {
  id: string;
  name: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, AutoCompleteModule, DrawerModule, ToastModule],
  providers: [MessageService],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css'
})
export class AdminDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);
  messageService = inject(MessageService);
  today = new Date();

  // Raw data (unfiltered)
  allPendingQuestions = signal<Question[]>([]);
  allApprovedQuestions = signal<Question[]>([]);
  allRejectedQuestions = signal<Question[]>([]);
  allDraftQuestions = signal<Question[]>([]);

  loading = signal(true);
  questionTypeCounts = signal<TypeCount[]>([]);
  totalQuestions = signal(0);
  activeTab = signal<'pending' | 'approved' | 'rejected'>('pending');

  // View state
  currentView = signal<'questions' | 'team' | 'report'>('questions');
  selectedTeacherId = signal<string | null>(null);

  // Getter/Setter for Drawer visibility
  get isDrawerVisible(): boolean {
    return !!this.selectedTeacherId();
  }
  set isDrawerVisible(value: boolean) {
    if (!value) this.selectedTeacherId.set(null);
  }

  // Filter state
  filterTeacher = signal('');
  filterQtype = signal('');
  filterCategory = signal('');

  // All registered teachers from the database
  allRegisteredTeachers = signal<Teacher[]>([]);

  // Dropdown options (derived from loaded data)
  categories = signal<Category[]>([]);

  // Unique teachers from the database (Source of Truth)
  availableTeachers = computed(() => {
    return [...this.allRegisteredTeachers()].sort((a, b) => a.name.localeCompare(b.name));
  });

  // Filter questions for the selected teacher (both authored and reviewed)
  selectedTeacherTasks = computed(() => {
    const tid = this.selectedTeacherId();
    if (!tid) return [];
    
    const allQs = [
      ...this.allPendingQuestions(), 
      ...this.allApprovedQuestions(), 
      ...this.allRejectedQuestions(),
      ...this.allDraftQuestions()
    ];
    return allQs.filter(q => q.created_by === tid || q.metadata?.assigned_to_id === tid)
      .map(q => ({
        id: q.id,
        name: q.name,
        question_text: q.question_text,
        qtype: q.qtype,
        status: q.status,
        version: q.version,
        metadata: q.metadata,
        created_at: q.created_at,
        updated_at: q.updated_at,
        created_by: q.created_by,
        category_id: q.category_id,
        isAuthor: q.created_by === tid,
        isReviewer: q.metadata?.assigned_to_id === tid,
        isPaid: !!q.metadata?.paid_at
      }))
      .sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at).getTime();
        const dateB = new Date(b.updated_at || b.created_at).getTime();
        return dateB - dateA;
      });
  });

  // Unique question types from all questions
  availableQtypes = computed(() => {
    const all = [...this.allPendingQuestions(), ...this.allApprovedQuestions(), ...this.allRejectedQuestions()];
    const types = new Set(all.map(q => q.qtype).filter(Boolean));
    return Array.from(types).sort();
  });

  // Filtered lists (computed from raw data + filters)
  pendingQuestions = computed(() => this.applyFilters(this.allPendingQuestions()));
  approvedQuestions = computed(() => this.applyFilters(this.allApprovedQuestions()));
  rejectedQuestions = computed(() => this.applyFilters(this.allRejectedQuestions()));

  // Calculate stats for each teacher for payment and performance tracking
  teacherPerformance = computed(() => {
    const teachers = this.allRegisteredTeachers();
    const allQs = [
      ...this.allPendingQuestions(), 
      ...this.allApprovedQuestions(), 
      ...this.allRejectedQuestions(),
      ...this.allDraftQuestions()
    ];
    
    return teachers.map(t => {
      const authored = allQs.filter(q => q.created_by === t.id);
      const assigned = allQs.filter(q => q.metadata?.assigned_to_id === t.id);
      
      return {
        ...t,
        stats: {
          authoredReady: authored.filter(q => q.status === 'approved').length,
          authoredPending: authored.filter(q => q.status !== 'approved').length,
          reviewsCompleted: assigned.filter(q => q.status === 'approved' || q.status === 'rejected').length,
          reviewsPending: assigned.filter(q => q.status === 'pending_review').length
        }
      };
    }).sort((a, b) => (b.stats.authoredReady + b.stats.reviewsCompleted) - (a.stats.authoredReady + a.stats.reviewsCompleted));
  });

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
        this.loadAllQuestions();
        this.loadQuestionTypeCounts();
        this.loadCategories();
        this.loadTeachers();
      }
    });
  }

  ngOnInit() {
    this.loadAllQuestions();
    this.loadQuestionTypeCounts();
    this.loadCategories();
    this.loadTeachers();
  }

  loadAllQuestions() {
    this.loadPendingQuestions();
    this.loadApprovedQuestions();
    this.loadRejectedQuestions();
    this.loadDraftQuestions();
  }

  private applyFilters(questions: Question[]): Question[] {
    let result = questions;

    const teacher = this.filterTeacher();
    if (teacher) {
      // If we are filtering by teacher name (as before) or we update to ID
      result = result.filter(q => q.metadata?.author_name === teacher);
    }

    const qtype = this.filterQtype();
    if (qtype) {
      result = result.filter(q => q.qtype === qtype);
    }

    const catId = this.filterCategory();
    if (catId) {
      result = result.filter(q => q.category_id === catId);
    }

    return result;
  }

  clearFilters() {
    this.filterTeacher.set('');
    this.filterQtype.set('');
    this.filterCategory.set('');
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterTeacher() || this.filterQtype() || this.filterCategory());
  }

  async loadCategories() {
    const { data, error } = await this.supabaseService.db
      .from('question_categories')
      .select('id, name')
      .order('sort_order', { ascending: true });

    if (!error && data) {
      this.categories.set(data as Category[]);
    }
  }

  async loadTeachers() {
    // 1. Try to fetch from user_roles
    const { data: roles, error: rolesError } = await this.supabaseService.db
      .from('user_roles')
      .select('user_id, role')
      .eq('role', 'teacher');

    if (rolesError) {
      console.error('Error loading teacher roles:', rolesError);
      return;
    }

    // 2. We also try to fetch from a 'profiles' table if it exists 
    // to get their real names. If not, we'll use a placeholder.
    const { data: profiles } = await this.supabaseService.db
      .from('profiles')
      .select('id, full_name');

    const profileMap = new Map<string, string>();
    profiles?.forEach(p => profileMap.set(p.id, p.full_name));

    const teachers: Teacher[] = (roles || []).map(r => ({
      id: r.user_id,
      // If we have a profile name, use it. Otherwise, use a friendly placeholder.
      name: profileMap.get(r.user_id) || `Teacher (${r.user_id.substring(0, 5)})`
    }));

    this.allRegisteredTeachers.set(teachers);
  }

  viewTeacherDetails(id: string) {
    this.selectedTeacherId.set(id);
    this.currentView.set('report');
  }

  async markAsPaid(question: Question) {
    const metadata = {
      ...(question.metadata || {}),
      paid_at: new Date().toISOString(),
      paid_by: this.supabaseService.currentUserName
    };

    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ metadata })
      .eq('id', question.id);

    if (!error) {
      this.loadAllQuestions();
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Task marked as paid' });
    }
  }

  async loadPendingQuestions() {
    this.loading.set(true);
    
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('status', 'pending_review')
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (!error && data) {
      this.allPendingQuestions.set(data as Question[]);
    }
    this.loading.set(false);
  }

  async loadApprovedQuestions() {
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('status', 'approved')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (!error && data) {
      this.allApprovedQuestions.set(data as Question[]);
    }
  }

  async loadRejectedQuestions() {
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('status', 'rejected')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (!error && data) {
      this.allRejectedQuestions.set(data as Question[]);
    }
  }

  async loadDraftQuestions() {
    const { data, error } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .eq('status', 'draft')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (!error && data) {
      this.allDraftQuestions.set(data as Question[]);
    }
  }

  async updateStatus(id: string, status: 'approved' | 'rejected') {
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ status })
      .eq('id', id);

    if (!error) {
      this.loadAllQuestions();
      this.loadQuestionTypeCounts();
    }
  }

  assigningQuestionId = signal<string | null>(null);
  filteredTeachers = signal<Teacher[]>([]);

  searchTeachers(event: any) {
    const query = event.query.toLowerCase();
    this.filteredTeachers.set(
      this.availableTeachers().filter(t => t.name.toLowerCase().includes(query))
    );
  }

  async assignToTeacher(question: Question, teacher: any) {
    // If teacher is just a string (manual type without selection), we might want to ignore or handle
    const teacherId = teacher?.id || null;
    const teacherName = teacher?.name || null;

    const metadata = {
      ...(question.metadata || {}),
      assigned_to_id: teacherId,
      assigned_to_name: teacherName,
      assigned_at: teacherId ? new Date().toISOString() : null,
      assigned_by: this.supabaseService.currentUserName
    };

    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ metadata })
      .eq('id', question.id);

    if (!error) {
      question.metadata = metadata;
      this.assigningQuestionId.set(null); // Close input after assign
      this.loadAllQuestions();
    }
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }

  getCategoryName(catId: string | null): string {
    if (!catId) return '';
    const cat = this.categories().find(c => c.id === catId);
    return cat ? cat.name : '';
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
