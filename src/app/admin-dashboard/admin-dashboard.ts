import { Component, inject, signal, computed, OnInit, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router, RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { AutoComplete } from 'primeng/autocomplete';
import { MessageService } from 'primeng/api';
import { Toast } from 'primeng/toast';
import { Paginator } from 'primeng/paginator';

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
  count: number;
  label: string;
  icon: string;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  parent_id: string | null;
  created_by: string;
  is_global: boolean;
  sort_order: number;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, AutoComplete, Toast, Paginator],
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
  currentView = signal<'questions' | 'team' | 'report' | 'categories'>('questions');
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

  // Debounced filter states to prevent 503 errors
  debouncedSearch = signal('');
  private searchSubject = new Subject<string>();

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
  // Category management state
  categories = signal<Category[]>([]);
  newCategoryName = '';
  newCategoryDescription = '';
  newCategoryParent: string | null = null;
  newCategoryIsGlobal = false;

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
  allQuestionsMeta = signal<any[]>([]);

  availableQtypes = computed(() => {
    return Object.keys(this.typeLabels).sort();
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
    const allQs = this.allQuestionsMeta();
    
    // Create a map of question IDs for quick lookup
    const qMap = new Map<string, any>();
    allQs.forEach(q => qMap.set(q.id, q));

    return teachers.map(t => {
      // 1. Authored stats (always from created_by)
      const authored = allQs.filter(q => q.created_by === t.id);
      
      // 2. Review stats (from the assignments table - the real source of truth)
      const myAssignments = assignments.filter(a => a.assigned_to_id === t.id);
      const myAssignedQIds = myAssignments.map(a => a.question_id);
      const assigned = myAssignedQIds.map(id => qMap.get(id)).filter(q => !!q);
      
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
    // Setup debouncing for search
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(val => {
      untracked(() => {
        this.debouncedSearch.set(val);
        this.currentPage.set(1);
      });
    });

    // Effect for data list (triggers on tab, page, or filter changes)
    effect(() => {
      const userRole = this.supabaseService.currentUserRole();
      if (userRole !== 'admin') return;

      // Track dependencies
      this.activeTab();
      this.currentPage();
      this.pageSize();
      this.debouncedSearch();
      this.filterTeacher();
      this.filterQtype();
      this.filterCategory();
      const view = this.currentView();
      
      untracked(() => {
        if (view === 'questions') {
          this.loadQuestionsForActiveTab();
        }
      });
    });

    // Effect for counts and metadata
    effect(() => {
      const userRole = this.supabaseService.currentUserRole();
      if (userRole !== 'admin') return;

      untracked(() => {
        this.loadCounts();
        this.loadQuestionTypeCounts();
        this.loadCategories();
        this.loadTeachers();
        this.loadAssignments();
      });
    });
  }

  ngOnInit() {
    // Initial load is handled by the effects above
  }

  onSearchChange(value: string) {
    this.filterSearch.set(value);
    this.searchSubject.next(value);
  }

  onTeacherFilterChange(value: string) {
    this.filterTeacher.set(value);
    this.currentPage.set(1);
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
      
      // Use DEBOUNCED search
      const search = this.debouncedSearch();
      if (search) {
        const kw = `%${search}%`;
        query = query.or(`name.ilike.${kw},question_text.ilike.${kw}`);
      }

      const from = (this.currentPage() - 1) * this.pageSize();
      const to = from + this.pageSize() - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: status === 'pending_review' })
        .range(from, to);

      if (error) throw error;

      untracked(() => {
        if (status === 'pending_review') this.pendingQuestions.set(data as Question[]);
        else if (status === 'approved') this.approvedQuestions.set(data as Question[]);
        else if (status === 'rejected') this.rejectedQuestions.set(data as Question[]);
        else if (status === 'draft') this.draftQuestions.set(data as Question[]);

        // Update count for the active tab (sync with totalCounts)
        const currentCounts = { ...this.totalCounts() };
        if (status === 'pending_review') currentCounts.pending = count || 0;
        else if (status === 'approved') currentCounts.approved = count || 0;
        else if (status === 'rejected') currentCounts.rejected = count || 0;
        else if (status === 'draft') currentCounts.draft = count || 0;
        this.totalCounts.set(currentCounts);
      });

    } catch (e) {
      console.error('Error loading admin questions:', e);
    } finally {
      untracked(() => this.loading.set(false));
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

      // Apply the same filters as loadQuestionsForActiveTab (using debounced values)
      if (this.filterQtype()) query = query.eq('qtype', this.filterQtype());
      if (this.filterCategory()) query = query.eq('category_id', this.filterCategory());
      if (this.filterTeacher()) query = query.ilike('metadata->>author_name', `%${this.filterTeacher()}%`);
      
      const search = this.debouncedSearch();
      if (search) {
        const kw = `%${search}%`;
        query = query.or(`name.ilike.${kw},question_text.ilike.${kw}`);
      }

      const { count } = await query;
      
      if (status === 'pending_review') counts.pending = count || 0;
      else if (status === 'approved') counts.approved = count || 0;
      else if (status === 'rejected') counts.rejected = count || 0;
      else if (status === 'draft') counts.draft = count || 0;
    }
    untracked(() => this.totalCounts.set(counts));
  }

  private applyFilters(questions: Question[]): Question[] {
    let result = questions;

    const teacher = this.filterTeacher();
    if (teacher) {
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

    const search = this.debouncedSearch()?.toLowerCase();
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
    this.searchSubject.next('');
    this.currentPage.set(1);
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterTeacher() || this.filterQtype() || this.filterCategory() || this.filterSearch());
  }

  async loadCategories() {
    const { data, error } = await this.supabaseService.db
      .from('question_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!error && data) {
      this.categories.set(data as Category[]);
    }
  }

  async loadTeachers() {
    const { data: roles, error: rolesError } = await this.supabaseService.db
      .from('user_roles')
      .select('user_id, role')
      .eq('role', 'teacher');

    if (rolesError) return;

    const { data: profiles } = await this.supabaseService.db
      .from('profiles')
      .select('id, full_name, email');

    const profileMap = new Map<string, {name: string, email?: string}>();
    profiles?.forEach(p => profileMap.set(p.id, { name: p.full_name, email: p.email }));

    const { data: qMeta } = await this.supabaseService.db
      .from('questions')
      .select('id, created_by, status, metadata')
      .is('deleted_at', null);

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
          const isGeneric = !existing.name || existing.name.toLowerCase() === 'teacher';
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
    this.allQuestionsMeta.set(qMeta || []);
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
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Question marked as paid' });
      this.loadQuestionsForActiveTab();
      this.loadCounts();
    }
  }

  async updateStatus(id: string, status: 'approved' | 'rejected') {
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ status })
      .eq('id', id);

    if (!error) {
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

    if (!admin) return;

    try {
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
      this.messageService.add({ severity: 'error', summary: 'Error', detail: err.message });
    }
  }

  async removeReviewer(question: Question, event: any) {
    const teacher: Teacher = event.value || event;
    const admin = this.supabaseService.currentUser();
    if (!admin) return;

    try {
      const { error: delError } = await this.supabaseService.db
        .from('assignments')
        .delete()
        .eq('question_id', question.id)
        .eq('assigned_to_id', teacher.id);

      if (delError) throw delError;

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

  updatePageSize(size: number) {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  onPageChange(event: any) {
    if (this.pageSize() !== event.rows) {
      this.updatePageSize(event.rows);
    } else {
      this.setPage(event.page + 1);
    }
  }

  setPage(page: number) {
    const total = this.totalPages;
    if (page >= 1 && (total === 0 || page <= total)) {
      if (this.currentPage() !== page) {
        this.currentPage.set(page);
      }
    }
  }

  get totalPages() {
    const status = this.activeTab();
    const count = status === 'pending' ? this.totalCounts().pending :
                 status === 'approved' ? this.totalCounts().approved :
                 status === 'rejected' ? this.totalCounts().rejected :
                 this.totalCounts().draft;
    return Math.ceil(count / this.pageSize());
  }

  async loadAssignments() {
    const { data, error } = await this.supabaseService.db
      .from('assignments')
      .select('question_id, assigned_to_id');
    
    if (!error && data) {
      this.allAssignments.set(data);
    }
  }

  // Category management methods for Admin
  async addCategory() {
    if (!this.newCategoryName.trim()) return;
    const user = this.supabaseService.currentUser();
    if (!user) return;

    const { error } = await this.supabaseService.db
      .from('question_categories')
      .insert({
        name: this.newCategoryName,
        description: this.newCategoryDescription,
        parent_id: this.newCategoryParent,
        created_by: user.id,
        is_global: this.newCategoryIsGlobal,
        sort_order: this.categories().length
      });

    if (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: error.message });
    } else {
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Category created' });
      this.newCategoryName = '';
      this.newCategoryDescription = '';
      this.newCategoryParent = null;
      this.newCategoryIsGlobal = false;
      this.loadCategories();
    }
  }

  async deleteCategory(id: string) {
    if (!confirm('Are you sure? Questions in this category will be moved to uncategorized.')) return;

    // First null out category_id for questions in this category
    await this.supabaseService.db
      .from('questions')
      .update({ category_id: null })
      .eq('category_id', id);

    const { error } = await this.supabaseService.db
      .from('question_categories')
      .delete()
      .eq('id', id);

    if (!error) {
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Category deleted' });
      this.loadCategories();
    } else {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: error.message });
    }
  }

  get flatCategories() {
    const flat: any[] = [];
    const build = (parentId: string | null, depth: number) => {
      const children = this.categories().filter(c => c.parent_id === parentId);
      children.forEach(c => {
        flat.push({ ...c, depth });
        build(c.id, depth + 1);
      });
    };
    build(null, 0);
    return flat;
  }
}
