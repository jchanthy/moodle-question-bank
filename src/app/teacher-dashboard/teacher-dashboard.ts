import { Component, inject, signal, computed, OnInit, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { ImportExportService, ParsedQuestion } from '../services/import-export.service';
import { Router, RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

export interface Question {
  id: string;
  name: string;
  question_text: string;
  general_feedback?: string;
  qtype: string;
  version: number;
  status: string;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  parent_id: string | null;
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
    comments?: {
      user: string;
      text: string;
      date: string;
    }[];
    tags?: string[];
  };
  history?: Question[];
  allVersions?: Question[];
  showHistory?: boolean;
  isEditingName?: boolean;
  category_id?: string | null;
  default_grade?: number;
  penalty?: number;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  parent_id: string | null;
  created_by: string;
  created_at: string;
  sort_order: number;
  is_global: boolean;
  question_count?: number;
  children?: Category[];
  isEditing?: boolean;
  depth: number;
}

import { Select } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Toast } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Paginator } from 'primeng/paginator';
import { Drawer } from 'primeng/drawer';

@Component({
  selector: 'app-teacher-dashboard',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, ReactiveFormsModule,
    Select, TableModule, Button, Dialog, 
    Toast, Paginator,
    Drawer
  ],
  providers: [MessageService],
  templateUrl: './teacher-dashboard.html',
  styleUrl: './teacher-dashboard.css'
})
export class TeacherDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  importExportService = inject(ImportExportService);
  router = inject(Router);
  messageService = inject(MessageService);
  Math = Math;

  myQuestions = signal<Question[]>([]);
  assignedQuestions = signal<Question[]>([]);
  loading = signal(true);
  showComments = signal(false);
  selectedQuestion = signal<Question | null>(null);
  newCommentText = '';
  currentView = signal<'my' | 'assigned' | 'archive'>('my');
  
  // Filters
  filterHidden = signal(false);
  filterType = signal<string>('');
  filterDateFrom = signal<string>('');
  filterDateTo = signal<string>('');
  filterStatus = signal<string>('');
  filterKeyword = signal<string>('');
  
  // Debouncing filters
  debouncedKeyword = signal<string>('');
  private keywordSubject = new Subject<string>();

  sortField = signal<'created_at' | 'updated_at' | 'name'>('updated_at');
  sortOrder = signal<'asc' | 'desc'>('desc');
  activeMenuId = signal<string | null>(null);
  totalCount = signal(0);

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

  // Selection & Pagination
  selectedIds = signal<Set<string>>(new Set());
  currentPage = signal(1);
  pageSize = signal(10);
  notification = signal<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  // Categories
  categories = signal<Category[]>([]);
  selectedCategoryId = signal<string | null>(null);
  showCategoryPanel = signal(false);
  newCategoryName = '';
  newCategoryDescription = '';
  newCategoryParent: string | null = null;
  newCategoryIsGlobal = false;
  editingCategory = signal<Category | null>(null);

  // Category Deletion Modal
  categoryToDelete = signal<Category | null>(null);
  deleteMoveToCategoryId = signal<string | null>(null);

  // Bulk Actions
  bulkTargetCategoryId = signal<string>('');

  // Import / Export
  showImportModal = signal(false);
  importFormat = signal<'moodle_xml' | 'gift' | 'aiken' | 'word_docx'>('moodle_xml');
  importTargetCategoryId = signal<string | null>(null);
  importNewCategoryName = signal<string>('');
  importText = '';
  importPreview = signal<ParsedQuestion[]>([]);
  importError = signal<string | null>(null);
  importLoading = signal(false);
  importLogs = signal<string[]>([]);
  private importFileBuffer: ArrayBuffer | null = null;

  // Computed properties for template
  paginatedQuestions = computed(() => {
    const view = this.currentView();
    if (view === 'assigned') return this.assignedQuestions();
    return this.myQuestions();
  });
  
  categoryOptions = computed(() => {
    return this.categories().map(c => ({ label: c.name, value: c.id }));
  });

  constructor() {
    // Setup debouncing for search keyword
    this.keywordSubject.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(val => {
      // Use untracked to prevent this update from triggering other effects prematurely
      untracked(() => {
        this.debouncedKeyword.set(val);
        this.currentPage.set(1);
      });
    });

    // Main data loading effect
    // We explicitly list dependencies to be clear about what triggers a reload
    effect(() => {
      const user = this.supabaseService.currentUser();
      if (!user) return;

      // Dependency tracking
      this.currentPage();
      this.pageSize();
      this.filterType();
      this.filterStatus();
      this.debouncedKeyword();
      this.filterHidden();
      this.selectedCategoryId();
      this.filterDateFrom();
      this.filterDateTo();
      this.sortField();
      this.sortOrder();

      // Execute side-effect untracked to prevent infinite loops
      untracked(() => {
        this.loadMyQuestions();
      });
    });

    // Separate effect for categories - only depends on login state and role
    effect(() => {
      const user = this.supabaseService.currentUser();
      const role = this.supabaseService.currentUserRole();
      if (user) {
        untracked(() => this.loadCategories());
      }
    });
  }

  ngOnInit() {
    // Initial load handled by effects
  }

  onKeywordChange(value: string) {
    this.filterKeyword.set(value);
    this.keywordSubject.next(value);
  }

  myQuestionsCount = signal(0);

  async loadMyQuestions() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    // Use untracked for state changes to avoid triggering recursive effects
    untracked(() => this.loading.set(true));

    try {
      // Background count for 'My Questions' badge
      this.supabaseService.db.from('questions').select('*', { count: 'exact', head: true })
        .eq('created_by', user.id).is('deleted_at', null)
        .then(({ count }) => untracked(() => this.myQuestionsCount.set(count || 0)));

      let query = this.supabaseService.db
        .from('questions')
        .select('*', { count: 'exact' });

      // If no category is selected, show only my questions
      // If a category is selected, we show questions in that category
      if (!this.selectedCategoryId()) {
        query = query.eq('created_by', user.id);
      } else {
        query = query.eq('category_id', this.selectedCategoryId()!);
      }

      // Apply filters
      if (this.currentView() === 'archive') {
        query = query.not('deleted_at', 'is', null);
      } else {
        if (!this.filterHidden()) {
          query = query.is('deleted_at', null);
        }
      }
      
      if (this.selectedCategoryId()) {
        query = query.eq('category_id', this.selectedCategoryId()!);
      }

      if (this.filterType()) {
        query = query.eq('qtype', this.filterType());
      }

      if (this.filterStatus()) {
        query = query.eq('status', this.filterStatus());
      }

      const kw = this.debouncedKeyword();
      if (kw) {
        const kwPattern = `%${kw}%`;
        query = query.or(`name.ilike.${kwPattern},question_text.ilike.${kwPattern}`);
      }

      if (this.filterDateFrom()) {
        query = query.gte('updated_at', this.filterDateFrom());
      }
      if (this.filterDateTo()) {
        query = query.lte('updated_at', this.filterDateTo());
      }

      // Pagination
      const page = this.currentPage();
      const size = this.pageSize();
      const from = (page - 1) * size;
      const to = from + size - 1;

      const { data, error, count } = await query
        .order(this.sortField(), { ascending: this.sortOrder() === 'asc' })
        .range(from, to);

      if (error) throw error;

      untracked(() => {
        this.myQuestions.set(data as Question[]);
        this.totalCount.set(count || 0);
      });

      this.loadAssignedQuestions();

    } catch (err: any) {
      this.showToast(err.message, 'error');
    } finally {
      untracked(() => this.loading.set(false));
    }
  }

  async loadAssignedQuestions() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    const { data: assignments } = await this.supabaseService.db
      .from('assignments')
      .select('question_id')
      .eq('assigned_to_id', user.id)
      .is('completed_at', null);

    if (assignments && assignments.length > 0) {
      const ids = assignments.map(a => a.question_id);
      const { data: qs } = await this.supabaseService.db
        .from('questions')
        .select('*')
        .in('id', ids)
        .is('deleted_at', null);
      
      untracked(() => this.assignedQuestions.set(qs as Question[] || []));
    } else {
      untracked(() => this.assignedQuestions.set([]));
    }
  }

  async loadCategories() {
    const user = this.supabaseService.currentUser();
    const role = this.supabaseService.currentUserRole();
    if (!user) return;

    let query = this.supabaseService.db
      .from('question_categories')
      .select('*, questions(count)')
      .order('sort_order', { ascending: true });

    // Best Practice: Teachers only see their own categories to reduce clutter.
    // Admins see all categories for management purposes.
    if (role !== 'admin') {
      query = query.or(`created_by.eq.${user.id},is_global.eq.true`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase Category Error:', error); // Log the detailed error
      this.showToast('Error loading categories: ' + error.message, 'error');
      return;
    }

    const catsWithCount = (data as any[]).map(c => ({
      ...c,
      question_count: c.questions?.[0]?.count || 0,
      depth: 0
    }));

    untracked(() => this.categories.set(catsWithCount));
  }

  flatCategories = computed(() => {
    const flat: Category[] = [];
    const build = (parentId: string | null, depth: number) => {
      const children = this.categories().filter(c => c.parent_id === parentId);
      children.forEach(c => {
        flat.push({ ...c, depth });
        build(c.id, depth + 1);
      });
    };
    build(null, 0);
    return flat;
  });

  selectCategory(id: string | null) {
    this.selectedCategoryId.set(id);
    this.currentPage.set(1);
  }

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
        is_global: this.newCategoryIsGlobal && this.supabaseService.currentUserRole() === 'admin',
        sort_order: this.categories().length
      });

    if (error) {
      this.showToast(error.message, 'error');
    } else {
      this.showToast('Category created', 'success');
      this.newCategoryName = '';
      this.newCategoryDescription = '';
      this.newCategoryParent = null;
      this.newCategoryIsGlobal = false;
      this.loadCategories();
    }
  }

  initiateDeleteCategory(catId: string) {
    const cat = this.categories().find(c => c.id === catId);
    if (cat) {
      this.categoryToDelete.set(cat);
    }
  }

  cancelDeleteCategory() {
    this.categoryToDelete.set(null);
  }

  async confirmDeleteCategory() {
    const cat = this.categoryToDelete();
    if (!cat) return;

    if (this.deleteMoveToCategoryId()) {
      const { error: moveError } = await this.supabaseService.db
        .from('questions')
        .update({ category_id: this.deleteMoveToCategoryId() })
        .eq('category_id', cat.id);
      
      if (moveError) {
        console.error('Move Questions Error:', moveError);
        this.showToast('Failed to move questions: ' + moveError.message, 'error');
        return;
      }
    }

    const { error } = await this.supabaseService.db
      .from('question_categories')
      .delete()
      .eq('id', cat.id);

    if (error) {
      this.showToast(error.message, 'error');
    } else {
      this.showToast('Category deleted', 'success');
      this.categoryToDelete.set(null);
      this.loadCategories();
    }
  }

  async deleteQuestion(id: string, name?: string) {
    if (!confirm(`Are you sure you want to delete "${name || 'this question'}"?`)) return;

    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      this.showToast(error.message, 'error');
    } else {
      this.showToast('Question moved to trash', 'success');
      this.loadMyQuestions();
      this.loadCategories();
    }
  }

  async withdrawFromReview(q: Question) {
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ status: 'draft' })
      .eq('id', q.id);

    if (error) {
      this.showToast(error.message, 'error');
    } else {
      q.status = 'draft';
      this.showToast('Withdrawn to draft', 'success');
    }
  }

  async updateQuestionName(q: Question, newName: string) {
    if (!newName.trim() || newName === q.name) {
      q.isEditingName = false;
      return;
    }

    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ name: newName })
      .eq('id', q.id);

    if (error) {
      this.showToast(error.message, 'error');
    } else {
      q.name = newName;
      this.showToast('Name updated', 'success');
    }
    q.isEditingName = false;
  }

  async updateQuestionStatus(q: Question, event: any) {
    const status = event.target.value;
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ status })
      .eq('id', q.id);

    if (error) {
      this.showToast(error.message, 'error');
    } else {
      q.status = status;
      this.showToast('Status updated', 'success');
    }
  }

  async switchVersion(q: Question, event: any) {
    const version = parseInt(event.target.value);
    this.showToast(`Switched to version ${version}`, 'info');
  }

  openComments(q: Question) {
    this.selectedQuestion.set(q);
    this.showComments.set(true);
  }

  closeComments() {
    this.showComments.set(false);
    this.selectedQuestion.set(null);
  }

  async addComment(qParam?: Question) {
    const q = qParam || this.selectedQuestion();
    if (!q || !this.newCommentText.trim()) return;

    const newComment = {
      user: this.supabaseService.currentUserName,
      text: this.newCommentText,
      date: new Date().toISOString()
    };

    const metadata = {
      ...(q.metadata || {}),
      comments: [...(q.metadata?.comments || []), newComment]
    };

    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ metadata })
      .eq('id', q.id);

    if (!error) {
      this.newCommentText = '';
      if (this.selectedQuestion()?.id === q.id) {
        this.selectedQuestion.set({ ...q, metadata });
      }
      this.loadMyQuestions();
    }
  }

  async exportToMoodle() {
    await this.exportQuestions('moodle_xml');
  }

  async exportXML() {
    await this.exportQuestions('moodle_xml');
  }

  async exportGIFT() {
    await this.exportQuestions('gift');
  }

  private async exportQuestions(format: 'moodle_xml' | 'gift') {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) {
      this.showToast('Select questions to export', 'info');
      return;
    }

    const { data: questions } = await this.supabaseService.db
      .from('questions')
      .select('*')
      .in('id', ids);

    if (!questions) return;

    const { data: answers } = await this.supabaseService.db
      .from('answers')
      .select('*')
      .in('question_id', ids);

    const answersMap = new Map<string, any[]>();
    answers?.forEach(a => {
      if (!answersMap.has(a.question_id)) answersMap.set(a.question_id, []);
      answersMap.get(a.question_id)!.push(a);
    });

    let content = '';
    let filename = '';
    let mimeType = '';

    if (format === 'moodle_xml') {
      content = this.importExportService.exportMoodleXML(questions, answersMap, this.categories());
      filename = `moodle_export_${new Date().toISOString().split('T')[0]}.xml`;
      mimeType = 'text/xml';
    } else {
      content = this.importExportService.exportGIFT(questions, answersMap);
      filename = `gift_export_${new Date().toISOString().split('T')[0]}.txt`;
      mimeType = 'text/plain';
    }

    this.importExportService.downloadFile(content, filename, mimeType);
    this.showToast(`Exported ${questions.length} questions`, 'success');
  }

  resetImport() {
    this.importText = '';
    this.importPreview.set([]);
    this.importError.set(null);
    this.importFileBuffer = null;
    this.importLogs.set([]);
  }

  async onImportFileSelected(event: any) {
    await this.onFileSelected(event);
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      this.importFileBuffer = e.target.result;
      
      if (file.name.endsWith('.xml')) {
        this.importFormat.set('moodle_xml');
        this.importText = new TextDecoder().decode(this.importFileBuffer!);
        this.parseImportPreview();
      } else if (file.name.endsWith('.docx')) {
        this.importFormat.set('word_docx');
        this.importLoading.set(true);
        try {
          const questions = await this.importExportService.parseDocx(this.importFileBuffer!);
          this.importPreview.set(questions);
        } catch (err) {
          this.showToast('Failed to parse Word file', 'error');
        } finally {
          this.importLoading.set(false);
        }
      }
    };
    reader.readAsArrayBuffer(file);
  }

  parseImportPreview() {
    if (!this.importText) return;
    try {
      let questions: ParsedQuestion[] = [];
      if (this.importFormat() === 'moodle_xml') {
        questions = this.importExportService.parseMoodleXML(this.importText);
      } else if (this.importFormat() === 'gift') {
        questions = this.importExportService.parseGIFT(this.importText);
      } else if (this.importFormat() === 'aiken') {
        questions = this.importExportService.parseAiken(this.importText);
      }
      this.importPreview.set(questions);
    } catch (err: any) {
      this.showToast('Failed to parse import data', 'error');
    }
  }

  async confirmImport() {
    const questions = this.importPreview();
    if (questions.length === 0) return;

    this.importLoading.set(true);
    let successCount = 0;
    const user = this.supabaseService.currentUser();
    if (!user) return;

    for (const q of questions) {
      try {
        const { data: newQ, error: qErr } = await this.supabaseService.db
          .from('questions')
          .insert({
            name: q.name,
            question_text: q.question_text,
            qtype: q.qtype,
            status: 'draft',
            created_by: user.id,
            category_id: this.importTargetCategoryId(),
            metadata: {
              author_name: this.supabaseService.currentUserName,
              author_email: user.email,
              tags: q.metadata?.['tags'] || []
            }
          })
          .select()
          .single();

        if (qErr) throw qErr;

        if (q.answers && q.answers.length > 0) {
          const answersToInsert = q.answers.map(a => ({
            question_id: newQ.id,
            answer_text: a.answer_text,
            fraction: a.fraction,
            feedback: a.feedback
          }));
          await this.supabaseService.db.from('answers').insert(answersToInsert);
        }

        successCount++;
      } catch (err: any) {
        console.error('Import failed for', q.name, err);
      }
    }

    this.showToast(`Imported ${successCount} questions`, 'success');
    this.importLoading.set(false);
    this.showImportModal.set(false);
    this.resetImport();
    this.loadMyQuestions();
    this.loadCategories();
  }

  showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    this.notification.set({ message, type });
    setTimeout(() => this.notification.set(null), 4000);
  }

  toggleSelection(id: string) {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
  }

  toggleSelectAll(event: any) {
    if (event.target.checked) {
      this.selectedIds.set(new Set(this.myQuestions().map(q => q.id)));
    } else {
      this.selectedIds.set(new Set());
    }
  }

  isAllSelected() {
    return this.myQuestions().length > 0 && this.selectedIds().size === this.myQuestions().length;
  }

  clearSelection() {
    this.selectedIds.set(new Set());
  }

  onPageChange(event: any) {
    if (this.pageSize() !== event.rows) {
      this.updatePageSize(event.rows);
    } else {
      this.setPage(event.page + 1);
    }
  }

  setPage(page: number) {
    const total = Math.ceil(this.totalCount() / this.pageSize());
    if (page >= 1 && (total === 0 || page <= total)) {
      if (this.currentPage() !== page) {
        this.currentPage.set(page);
      }
    }
  }

  updatePageSize(size: number) {
    if (this.pageSize() !== size) {
      this.pageSize.set(size);
      this.currentPage.set(1);
    }
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }

  async clearFilters() {
    this.filterKeyword.set('');
    this.filterType.set('');
    this.filterStatus.set('');
    this.filterDateFrom.set('');
    this.filterDateTo.set('');
    this.filterHidden.set(false);
    this.selectedCategoryId.set(null);
    this.keywordSubject.next('');
    this.currentPage.set(1);
  }

  toggleHiddenFilter() {
    this.filterHidden.set(!this.filterHidden());
    this.currentPage.set(1);
  }

  async selectAllQuestions() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    untracked(() => this.loading.set(true));
    try {
      let query = this.supabaseService.db
        .from('questions')
        .select('id')
        .eq('created_by', user.id);

      if (this.currentView() === 'archive') {
        query = query.not('deleted_at', 'is', null);
      } else {
        query = query.is('deleted_at', null);
      }

      if (this.selectedCategoryId()) {
        query = query.eq('category_id', this.selectedCategoryId()!);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (data) {
        untracked(() => {
          this.selectedIds.set(new Set(data.map(q => q.id)));
          this.showToast(`Selected all ${data.length} questions`, 'success');
        });
      }
    } catch (err: any) {
      this.showToast(err.message, 'error');
    } finally {
      untracked(() => this.loading.set(false));
    }
  }

  async moveSelectedQuestions(categoryId: string) {
    if (!categoryId) return;
    const ids = Array.from(this.selectedIds());
    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ category_id: categoryId })
      .in('id', ids);
    
    if (!error) {
      this.showToast(`Moved ${ids.length} questions`, 'success');
      this.clearSelection();
      this.loadMyQuestions();
      this.loadCategories();
    }
  }

  async bulkDeleteQuestions() {
    const ids = Array.from(this.selectedIds());
    if (!confirm(`Are you sure you want to delete ${ids.length} questions?`)) return;

    const { error } = await this.supabaseService.db
      .from('questions')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids);

    if (!error) {
      this.showToast(`Deleted ${ids.length} questions`, 'success');
      this.clearSelection();
      this.loadMyQuestions();
      this.loadCategories();
    }
  }
}
