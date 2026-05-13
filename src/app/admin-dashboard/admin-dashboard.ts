import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterModule } from '@angular/router';
import { AutoComplete } from 'primeng/autocomplete';
import { MessageService } from 'primeng/api';
import { Toast } from 'primeng/toast';

interface Question {
  id: string;
  name: string;
  question_text: string;
  qtype: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  version: number;
  metadata?: {
    author_name?: string;
    author_email?: string;
    modified_by?: string;
    modified_by_email?: string;
    modified_at?: string;
    image_url?: string;
    assigned_to_id?: string;
    assigned_to_name?: string;
    assigned_reviewers?: { id: string, name: string }[];
    paid_at?: string;
    comments?: { user: string; text: string; date: string }[];
    tags?: string[];
  };
  created_at: string;
  updated_at?: string;
  created_by: string;
  category_id: string | null;
}

interface Teacher {
  id: string;
  name: string;
  email?: string;
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
  imports: [CommonModule, RouterModule, FormsModule, AutoComplete, Toast],
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
  allAssignments = signal<{question_id: string, assigned_to_id: string}[]>([]);

  loading = signal(true);
  questionTypeCounts = signal<TypeCount[]>([]);
  totalQuestions = signal(0);
  // Tabs
  activeTab = signal<'pending' | 'approved' | 'rejected' | 'draft'>('pending');

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
  filterSearch = signal('');

  protected readonly Math = Math;

  // Pagination
  currentPage = signal(1);
  pageSize = signal(10);
  totalCounts = signal({
    pending: 0,
    approved: 0,
    rejected: 0,
    draft: 0
  });

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
    const assignments = this.allAssignments();
    return allQs.filter(q => {
      const isAuthor = q.created_by === tid;
      const isReviewer = assignments.some(a => a.question_id === q.id && a.assigned_to_id === tid);
      return isAuthor || isReviewer;
    })
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
        isReviewer: assignments.some(a => a.question_id === q.id && a.assigned_to_id === tid),
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
  pendingQuestions = signal<Question[]>([]);
  approvedQuestions = signal<Question[]>([]);
  rejectedQuestions = signal<Question[]>([]);
  draftQuestions = signal<Question[]>([]);

  // Calculate stats for each teacher for payment and performance tracking
  teacherPerformance = computed(() => {
    const teachers = this.allRegisteredTeachers();
    const assignments = this.allAssignments();
    const allQs = [
      ...this.allPendingQuestions(), 
      ...this.allApprovedQuestions(), 
      ...this.allRejectedQuestions(),
      ...this.allDraftQuestions()
    ];
    
    // Create a map of question IDs for quick lookup
    const qMap = new Map<string, Question>();
    allQs.forEach(q => qMap.set(q.id, q));

    return teachers.map(t => {
      // 1. Authored stats (always from created_by)
      const authored = allQs.filter(q => q.created_by === t.id);
      
      // 2. Review stats (from the assignments table - the real source of truth)
      const myAssignments = assignments.filter(a => a.assigned_to_id === t.id);
      const myAssignedQIds = myAssignments.map(a => a.question_id);
      const assigned = myAssignedQIds.map(id => qMap.get(id)).filter((q): q is Question => !!q);
      
      return {
        ...t,
        stats: {
          authoredReady: authored.filter(q => q.status === 'approved').length,
          authoredPending: authored.filter(q => q.status !== 'approved').length,
          reviewsCompleted: assigned.filter(q => q.status === 'approved' || q.status === 'rejected').length,
          reviewsPending: assigned.filter(q => q.status !== 'approved' && q.status !== 'rejected').length
        }
      };
    }).sort((a, b) => {
      const activityA = a.stats.authoredReady + a.stats.authoredPending + a.stats.reviewsCompleted + a.stats.reviewsPending;
      const activityB = b.stats.authoredReady + b.stats.authoredPending + b.stats.reviewsCompleted + b.stats.reviewsPending;
      return activityB - activityA;
    });
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
        // Watch all filters and pagination signals to trigger re-load
        this.activeTab();
        this.currentPage();
        this.pageSize();
        this.filterTeacher();
        this.filterQtype();
        this.filterCategory();
        this.filterSearch();
        this.currentView();

        if (this.currentView() === 'questions') {
          this.loadQuestionsForActiveTab();
          this.loadCounts();
        }
      }
    });

    effect(() => {
      if (this.supabaseService.currentUserRole() === 'admin') {
        this.loadQuestionTypeCounts();
        this.loadCategories();
        this.loadTeachers();
        this.loadAssignments();
      }
    });
  }

  ngOnInit() {
    // Initial load is handled by the effects above
  }

  async loadQuestionsForActiveTab() {
    this.loading.set(true);
    try {
      const status = this.activeTab() === 'draft' ? 'draft' : 
                     this.activeTab() === 'approved' ? 'approved' :
                     this.activeTab() === 'rejected' ? 'rejected' : 'pending_review';

      let query = this.supabaseService.db
        .from('questions')
        .select('*', { count: 'exact' })
        .eq('status', status)
        .is('deleted_at', null);

      // Apply Filters
      if (this.filterQtype()) query = query.eq('qtype', this.filterQtype());
      if (this.filterCategory()) query = query.eq('category_id', this.filterCategory());
      if (this.filterTeacher()) query = query.ilike('metadata->>author_name', `%${this.filterTeacher()}%`);
      if (this.filterSearch()) {
        const kw = `%${this.filterSearch()}%`;
        query = query.or(`name.ilike.${kw},question_text.ilike.${kw}`);
      }

      const from = (this.currentPage() - 1) * this.pageSize();
      const to = from + this.pageSize() - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: status === 'pending_review' })
        .range(from, to);

      if (error) throw error;

      if (status === 'pending_review') this.pendingQuestions.set(data as Question[]);
      else if (status === 'approved') this.approvedQuestions.set(data as Question[]);
      else if (status === 'rejected') this.rejectedQuestions.set(data as Question[]);
      else if (status === 'draft') this.draftQuestions.set(data as Question[]);

      // Update count for the active tab
      const counts = { ...this.totalCounts() };
      if (status === 'pending_review') counts.pending = count || 0;
      else if (status === 'approved') counts.approved = count || 0;
      else if (status === 'rejected') counts.rejected = count || 0;
      else if (status === 'draft') counts.draft = count || 0;
      this.totalCounts.set(counts);

    } catch (e) {
      console.error('Error loading admin questions:', e);
    } finally {
      this.loading.set(false);
    }
  }

  async loadCounts() {
    // Load counts for all statuses to update tab labels
    const statuses = ['pending_review', 'approved', 'rejected', 'draft'];
    const counts = { ...this.totalCounts() };

    for (const status of statuses) {
      let query = this.supabaseService.db
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('status', status)
        .is('deleted_at', null);

      // Apply the same filters as loadQuestionsForActiveTab
      if (this.filterQtype()) query = query.eq('qtype', this.filterQtype());
      if (this.filterCategory()) query = query.eq('category_id', this.filterCategory());
      if (this.filterTeacher()) query = query.ilike('metadata->>author_name', `%${this.filterTeacher()}%`);
      if (this.filterSearch()) {
        const kw = `%${this.filterSearch()}%`;
        query = query.or(`name.ilike.${kw},question_text.ilike.${kw}`);
      }

      const { count } = await query;
      
      if (status === 'pending_review') counts.pending = count || 0;
      else if (status === 'approved') counts.approved = count || 0;
      else if (status === 'rejected') counts.rejected = count || 0;
      else if (status === 'draft') counts.draft = count || 0;
    }
    this.totalCounts.set(counts);
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

    const search = this.filterSearch()?.toLowerCase();
    if (search) {
      result = result.filter(q => 
        q.name?.toLowerCase().includes(search) || 
        q.question_text?.toLowerCase().includes(search)
      );
    }

    return result;
  }

  clearFilters() {
    this.filterTeacher.set('');
    this.filterQtype.set('');
    this.filterCategory.set('');
    this.filterSearch.set('');
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterTeacher() || this.filterQtype() || this.filterCategory() || this.filterSearch());
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
      .select('id, full_name, email');

    const profileMap = new Map<string, {name: string, email?: string}>();
    profiles?.forEach(p => profileMap.set(p.id, { name: p.full_name, email: p.email }));

    // 3. Fallback: Lookup in questions table for missing names/emails in metadata
    const { data: qMeta } = await this.supabaseService.db
      .from('questions')
      .select('created_by, metadata');

    qMeta?.forEach(q => {
      const meta = (q.metadata as any) || {};
      const uid = q.created_by;
      const existing = profileMap.get(uid);
      
      const metaName = meta.author_name || meta.modified_by;
      const metaEmail = meta.author_email || meta.modified_by_email;

      if (metaName || metaEmail) {
        if (!existing) {
          profileMap.set(uid, { 
            name: metaName || `Teacher (${uid.substring(0, 5)})`, 
            email: metaEmail 
          });
        } else {
          const isGeneric = !existing.name || 
                           existing.name.toLowerCase() === 'teacher' || 
                           existing.name.toLowerCase().startsWith('teacher (');
          
          if (isGeneric || !existing.email) {
            profileMap.set(uid, {
              name: (isGeneric && metaName) ? metaName : existing.name,
              email: existing.email || metaEmail
            });
          }
        }
      }
    });

    const teachers: Teacher[] = (roles || []).map(r => {
      const prof = profileMap.get(r.user_id);
      return {
        id: r.user_id,
        name: prof?.name || `Teacher (${r.user_id.substring(0, 5)})`,
        email: prof?.email
      };
    });

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
      this.loadQuestionsForActiveTab();
      this.loadCounts();
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Task marked as paid' });
    }
  }

  async loadAssignments() {
    const { data, error } = await this.supabaseService.db
      .from('assignments')
      .select('question_id, assigned_to_id');
    
    if (!error && data) {
      this.allAssignments.set(data);
    }
  }

  // Pagination Helpers
  get totalPages() {
    const status = this.activeTab();
    const count = status === 'pending' ? this.totalCounts().pending :
                 status === 'approved' ? this.totalCounts().approved :
                 status === 'rejected' ? this.totalCounts().rejected :
                 this.totalCounts().draft;
    return Math.ceil(count / this.pageSize());
  }

  getVisiblePages(): number[] {
    const current = this.currentPage();
    const total = this.totalPages;
    const maxVisible = 5;
    const half = Math.floor(maxVisible / 2);
    
    let start = current - half;
    let end = current + half;
    
    if (start < 1) {
      start = 1;
      end = Math.min(maxVisible, total);
    }
    
    if (end > total) {
      end = total;
      start = Math.max(1, end - maxVisible + 1);
    }
    
    const pages = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  setPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage.set(page);
    }
  }

  async updateStatus(id: string, status: 'approved' | 'rejected') {
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ status })
      .eq('id', id);

    if (!error) {
      // Also update all assignments for this question to reflect the status
      await this.supabaseService.db
        .from('assignments')
        .update({ 
          status: status === 'approved' ? 'completed' : 'rejected',
          completed_at: status === 'approved' ? new Date().toISOString() : null
        })
        .eq('question_id', id)
        .is('completed_at', null);

      this.loadQuestionsForActiveTab();
      this.loadCounts();
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

  getAssignedTeachers(questionId: string): Teacher[] {
    const assignedIds = this.allAssignments()
      .filter(a => a.question_id === questionId)
      .map(a => a.assigned_to_id);
    
    return this.allRegisteredTeachers().filter(t => assignedIds.includes(t.id));
  }

  async addReviewer(question: Question, event: any) {
    const teacher: Teacher = event.value || event;
    const admin = this.supabaseService.currentUser();
    const adminName = this.supabaseService.currentUserName;

    if (!admin) {
      this.messageService.add({ severity: 'error', summary: 'Authentication Error', detail: 'You must be logged in as an admin to assign reviewers.' });
      return;
    }

    console.log('Adding reviewer:', teacher.name, 'to question:', question.id, 'Assigned by:', adminName, admin.id);

    try {
      // 1. Update Assignments Table
      const { error: insError } = await this.supabaseService.db
        .from('assignments')
        .insert({
          question_id: question.id,
          assigned_to_id: teacher.id,
          assigned_to_name: teacher.name,
          assigned_by_id: admin?.id,
          assigned_by_name: adminName,
          status: 'assigned',
          version: question.version
        });

      if (insError) throw insError;

      // 2. Update Question Metadata
      const currentReviewers = question.metadata?.assigned_reviewers || [];
      if (!currentReviewers.find(r => r.id === teacher.id)) {
        const updatedReviewers = [...currentReviewers, { id: teacher.id, name: teacher.name }];
        const metadata = {
          ...(question.metadata || {}),
          assigned_reviewers: updatedReviewers,
          assigned_to_id: updatedReviewers[0].id,
          assigned_to_name: updatedReviewers[0].name,
          assigned_at: new Date().toISOString(),
          assigned_by: adminName
        };

        await this.supabaseService.db
          .from('questions')
          .update({ metadata })
          .eq('id', question.id);
        
        question.metadata = metadata;
      }

      this.messageService.add({ severity: 'success', summary: 'Success', detail: `Reviewer ${teacher.name} added` });
      this.loadAssignments();
    } catch (err: any) {
      console.error('Error adding reviewer:', err);
      this.messageService.add({ severity: 'error', summary: 'Error', detail: err.message });
    }
  }

  async removeReviewer(question: Question, event: any) {
    const teacher: Teacher = event.value || event;
    const admin = this.supabaseService.currentUser();
    if (!admin) {
      this.messageService.add({ severity: 'error', summary: 'Authentication Error', detail: 'You must be logged in as an admin to remove reviewers.' });
      return;
    }

    console.log('Removing reviewer:', teacher.name, 'from question:', question.id, 'Requested by:', admin.id);

    try {
      // 1. Remove from Assignments Table
      const { error: delError } = await this.supabaseService.db
        .from('assignments')
        .delete()
        .eq('question_id', question.id)
        .eq('assigned_to_id', teacher.id);

      if (delError) throw delError;

      // 2. Update Question Metadata
      const currentReviewers = question.metadata?.assigned_reviewers || [];
      const updatedReviewers = currentReviewers.filter(r => r.id !== teacher.id);
      const metadata = {
        ...(question.metadata || {}),
        assigned_reviewers: updatedReviewers,
        assigned_to_id: updatedReviewers.length > 0 ? updatedReviewers[0].id : undefined,
        assigned_to_name: updatedReviewers.length > 0 ? updatedReviewers[0].name : undefined,
      };

      await this.supabaseService.db
        .from('questions')
        .update({ metadata })
        .eq('id', question.id);

      question.metadata = metadata;
      this.messageService.add({ severity: 'info', summary: 'Removed', detail: `Reviewer ${teacher.name} removed` });
      this.loadAssignments();
    } catch (err: any) {
      console.error('Error removing reviewer:', err);
      this.messageService.add({ severity: 'error', summary: 'Error', detail: err.message });
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

  async deleteQuestion(id: string) {
    if (!confirm('Are you sure you want to move this question to trash?')) return;

    try {
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Question moved to trash' });
      this.loadQuestionsForActiveTab();
      this.loadCounts();
      this.loadQuestionTypeCounts();
    } catch (err: any) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: err.message });
    }
  }
}
