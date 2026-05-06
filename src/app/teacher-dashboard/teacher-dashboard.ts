import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { ImportExportService, ParsedQuestion } from '../services/import-export.service';
import { Router, RouterModule } from '@angular/router';

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
    modified_by?: string;
    modified_at?: string;
    image_url?: string;
    comments?: {
      user: string;
      text: string;
      date: string;
    }[];
  };
  history?: Question[];
  allVersions?: Question[];
  showHistory?: boolean;
  isEditingName?: boolean;
  category_id?: string | null;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  parent_id: string | null;
  created_by: string;
  created_at: string;
  sort_order: number;
  question_count?: number;
  children?: Category[];
  isEditing?: boolean;
}

import { Select } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { PaginatorModule } from 'primeng/paginator';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'app-teacher-dashboard',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, 
    Select, TableModule, ButtonModule, DialogModule, 
    ToastModule, TagModule, TooltipModule, PaginatorModule,
    DrawerModule
  ],
  providers: [MessageService],
  templateUrl: './teacher-dashboard.html',
  styleUrl: './teacher-dashboard.css'
})
export class TeacherDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  importExportService = inject(ImportExportService);
  router = inject(Router);
  Math = Math;

  myQuestions = signal<Question[]>([]);
  loading = signal(true);
  showComments = signal(false);
  selectedQuestion = signal<Question | null>(null);
  newCommentText = '';
  
  // Filters
  filterHidden = signal(false);
  filterType = signal<string>('');
  filterDateFrom = signal<string>('');
  filterDateTo = signal<string>('');
  filterStatus = signal<string>('');
  filterKeyword = signal<string>('');
  sortField = signal<'created_at' | 'updated_at' | 'name'>('updated_at');
  sortOrder = signal<'asc' | 'desc'>('desc');

  filteredQuestions = computed(() => {
    let q = this.myQuestions();
    
    // Keyword search
    const kw = this.filterKeyword().toLowerCase();
    if (kw) {
      q = q.filter(x => 
        x.name.toLowerCase().includes(kw) || 
        x.question_text.toLowerCase().includes(kw) || 
        (x.general_feedback && x.general_feedback.toLowerCase().includes(kw)) ||
        (x.id && x.id.toLowerCase().includes(kw))
      );
    }
    
    // Type filter
    if (this.filterType()) {
      q = q.filter(x => x.qtype === this.filterType());
    }
    
    // Status filter
    if (this.filterStatus()) {
      q = q.filter(x => x.status === this.filterStatus());
    }
    
    // Date filter
    if (this.filterDateFrom()) {
      const from = new Date(this.filterDateFrom()).getTime();
      q = q.filter(x => new Date(x.updated_at || x.created_at).getTime() >= from);
    }
    if (this.filterDateTo()) {
      const to = new Date(this.filterDateTo()).getTime() + 86400000; // include the whole day
      q = q.filter(x => new Date(x.updated_at || x.created_at).getTime() <= to);
    }
    
    // Sorting
    const field = this.sortField();
    const order = this.sortOrder();
    
    q.sort((a, b) => {
      let valA: any = a[field as keyof Question] || a.created_at;
      let valB: any = b[field as keyof Question] || b.created_at;
      
      // Special case for updated_at which might be null
      if (field === 'updated_at') {
        valA = a.metadata?.modified_at || a.updated_at || a.created_at;
        valB = b.metadata?.modified_at || b.updated_at || b.created_at;
      }

      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });

    return q;
  });

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
  editingCategory = signal<Category | null>(null);

  // Category Deletion Modal
  categoryToDelete = signal<Category | null>(null);
  deleteMoveToCategoryId = signal<string | null>(null);

  // Bulk Actions
  bulkTargetCategoryId = signal<string>('');

  // Import / Export
  showImportModal = signal(false);
  importFormat = signal<'moodle_xml' | 'gift' | 'aiken'>('moodle_xml');
  importText = '';
  importPreview = signal<ParsedQuestion[]>([]);
  importError = signal<string | null>(null);
  importLoading = signal(false);
  importLogs = signal<string[]>([]);

  constructor() {
    effect(() => {
      if (this.supabaseService.currentUser()) {
        this.loadMyQuestions();
        this.loadCategories();
      }
    });
  }

  ngOnInit() {
    this.loadMyQuestions();
    this.loadCategories();
  }

  getPendingCount() {
    return this.myQuestions().filter(q => q.status === 'pending_review').length;
  }

  getReadyCount() {
    return this.myQuestions().filter(q => q.status === 'approved').length;
  }

  getRejectedCount() {
    return this.myQuestions().filter(q => q.status === 'rejected').length;
  }

  async loadMyQuestions() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    this.loading.set(true);
    try {
      let query = this.supabaseService.db
        .from('questions')
        .select('*')
        .eq('created_by', user.id);

      if (!this.filterHidden()) {
        query = query.is('deleted_at', null);
      }

      // Filter by category if one is selected
      if (this.selectedCategoryId()) {
        query.eq('category_id', this.selectedCategoryId()!);
      }

      const { data, error } = await query.order('version', { ascending: false });

      if (error) throw error;

      // Grouping Logic: Group by "Family" (Parent ID or own ID if it's the root)
      const groups = new Map<string, Question[]>();
      
      data.forEach((q: Question) => {
        const familyId = q.parent_id || q.id;
        if (!groups.has(familyId)) {
          groups.set(familyId, []);
        }
        groups.get(familyId)?.push(q);
      });

      // Transform groups into a flat list of "Latest" questions with nested history
      const processed: Question[] = [];
      groups.forEach((versions) => {
        // Deduplicate versions by number (keep latest record for each version)
        const versionMap = new Map<number, Question>();
        versions.forEach(v => {
          if (!versionMap.has(v.version) || new Date(v.created_at) > new Date(versionMap.get(v.version)!.created_at)) {
            versionMap.set(v.version, v);
          }
        });
        
        const uniqueVersions = Array.from(versionMap.values());
        uniqueVersions.sort((a, b) => (b.version || 0) - (a.version || 0));
        
        const latest = { ...uniqueVersions[0] };
        latest.history = uniqueVersions.slice(1);
        latest.allVersions = uniqueVersions;
        latest.showHistory = false;
        latest.isEditingName = false;
        processed.push(latest);
      });

      this.myQuestions.set(processed);
    } catch (error: any) {
      console.error('Error loading questions:', error);
    } finally {
      this.loading.set(false);
    }
  }

  toggleHiddenFilter() {
    this.filterHidden.set(!this.filterHidden());
    this.loadMyQuestions();
  }

  clearFilters() {
    this.filterHidden.set(false);
    this.filterType.set('');
    this.filterDateFrom.set('');
    this.filterDateTo.set('');
    this.filterStatus.set('');
    this.filterKeyword.set('');
    this.sortField.set('updated_at');
    this.sortOrder.set('desc');
    this.selectedCategoryId.set(null);
    this.currentPage.set(1);
    this.loadMyQuestions();
  }

  // Pagination Logic
  get totalPages() {
    return Math.ceil(this.filteredQuestions().length / this.pageSize());
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
      start = Math.max(1, total - maxVisible + 1);
    }
    
    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  get paginatedQuestions() {
    const start = (this.currentPage() - 1) * this.pageSize();
    const end = start + this.pageSize();
    return this.filteredQuestions().slice(start, end);
  }

  setPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage.set(page);
      this.selectedIds.set(new Set()); // Clear selection on page change
    }
  }

  updatePageSize(size: number) {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.selectedIds.set(new Set());
  }

  onPageChange(event: any) {
    if (this.pageSize() !== event.rows) {
      this.updatePageSize(event.rows);
    } else {
      this.setPage(event.page + 1);
    }
  }

  // Selection Logic
  toggleSelectAll(event: any) {
    const checked = event.target.checked;
    const newSet = new Set<string>();
    if (checked) {
      this.paginatedQuestions.forEach(q => newSet.add(q.id));
    }
    this.selectedIds.set(newSet);
  }

  selectAllQuestions() {
    const newSet = new Set<string>();
    this.myQuestions().forEach(q => newSet.add(q.id));
    this.selectedIds.set(newSet);
  }

  toggleSelection(id: string) {
    const newSet = new Set(this.selectedIds());
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    this.selectedIds.set(newSet);
  }

  clearSelection() {
    this.selectedIds.set(new Set());
  }

  // Bulk Move Logic
  async moveSelectedQuestions(targetCategoryId: string) {
    if (this.selectedIds().size === 0 || !targetCategoryId) return;
    
    // Use null if 'null' was explicitly selected (move to root)
    const category_id = targetCategoryId === 'null' ? null : targetCategoryId;

    this.loading.set(true);
    try {
      const selectedIdsArray = Array.from(this.selectedIds());
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ category_id })
        .in('id', selectedIdsArray);

      if (error) throw error;

      this.showToast(`Successfully moved ${selectedIdsArray.length} question(s).`);
      this.clearSelection();
      await this.loadMyQuestions();
      await this.loadCategories(); // To update question counts in sidebar
    } catch (err: any) {
      this.showToast('Error moving questions: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async bulkDeleteQuestions() {
    const count = this.selectedIds().size;
    if (count === 0) return;
    if (!confirm(`Are you sure you want to move ${count} selected question(s) to trash?`)) return;

    this.loading.set(true);
    try {
      const selectedIdsArray = Array.from(this.selectedIds());
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', selectedIdsArray);

      if (error) throw error;

      this.showToast(`Moved ${count} questions to trash.`);
      this.clearSelection();
      await this.loadMyQuestions();
      await this.loadCategories();
    } catch (err: any) {
      this.showToast('Error deleting questions: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async deleteQuestion(id: string, name: string) {
    if (!confirm(`Are you sure you want to move "${name}" to trash?`)) return;

    this.loading.set(true);
    try {
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      
      this.showToast(`Question moved to trash`);
      await this.loadMyQuestions();
    } catch (err: any) {
      this.showToast('Error deleting question: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  isAllSelected() {
    const paginated = this.paginatedQuestions;
    return paginated.length > 0 && paginated.every(q => this.selectedIds().has(q.id));
  }

  async deleteSelected() {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0 || !confirm(`Move ${ids.length} questions to trash?`)) return;

    this.loading.set(true);
    try {
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids);

      if (error) throw error;
      
      this.showToast(`${ids.length} questions moved to trash`);
      this.selectedIds.set(new Set());
      await this.loadMyQuestions();
    } catch (err: any) {
      this.showToast('Error deleting questions: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  toggleHistory(question: Question) {
    question.showHistory = !question.showHistory;
  }

  openComments(question: Question) {
    this.selectedQuestion.set(question);
    this.showComments.set(true);
    this.newCommentText = '';
  }

  closeComments() {
    this.showComments.set(false);
    this.selectedQuestion.set(null);
  }

  async addComment() {
    const q = this.selectedQuestion();
    const text = this.newCommentText;
    if (!q || !text.trim()) return;

    const user = this.supabaseService.currentUserName;
    const newComment = {
      user,
      text: text.trim(),
      date: new Date().toISOString()
    };

    const updatedMetadata = {
      ...(q.metadata || {}),
      comments: [...(q.metadata?.comments || []), newComment]
    };

    try {
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ metadata: updatedMetadata })
        .eq('id', q.id);

      if (error) throw error;

      // Update local state and trigger signal refresh
      q.metadata = updatedMetadata;
      this.myQuestions.set([...this.myQuestions()]); 
      this.newCommentText = '';
      this.showToast('Comment added successfully!');
    } catch (err: any) {
      this.showToast('Error adding comment: ' + err.message, 'error');
    }
  }

  async updateQuestionName(question: Question, newName: string) {
    if (!newName.trim() || newName === question.name) {
      question.isEditingName = false;
      return;
    }

    try {
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ name: newName.trim() })
        .eq('id', question.id);

      if (error) throw error;
      question.name = newName.trim();
      question.isEditingName = false;
      this.showToast('Question renamed successfully!');
    } catch (err: any) {
      this.showToast('Error renaming question: ' + err.message, 'error');
    }
  }

  async updateQuestionStatus(question: Question, newStatus: string) {
    if (newStatus === question.status) return;

    try {
      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ status: newStatus })
        .eq('id', question.id);

      if (error) throw error;
      question.status = newStatus;
      this.showToast(`Status updated to ${newStatus.replace('_', ' ')}`);
    } catch (err: any) {
      this.showToast('Error updating status: ' + err.message, 'error');
    }
  }

  switchVersion(question: Question, targetId: string) {
    if (targetId === question.id) return;
    this.router.navigate(['/teacher/edit-question', targetId]);
  }

  messageService = inject(MessageService);

  showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    this.messageService.add({ severity: type, summary: type.toUpperCase(), detail: message, life: 4000 });
  }

  async signOut() {
    await this.supabaseService.auth.signOut();
    this.router.navigate(['/auth']);
  }

  // ====== IMPORT / EXPORT ======

  private async fetchAnswersMap(questionIds: string[]): Promise<Map<string, any[]>> {
    const { data } = await this.supabaseService.db
      .from('answers')
      .select('*')
      .in('question_id', questionIds);

    const map = new Map<string, any[]>();
    (data || []).forEach((a: any) => {
      if (!map.has(a.question_id)) map.set(a.question_id, []);
      map.get(a.question_id)!.push(a);
    });
    return map;
  }

  async exportXML() {
    const questions = this.selectedIds().size > 0
      ? this.myQuestions().filter(q => this.selectedIds().has(q.id))
      : this.myQuestions();

    if (questions.length === 0) { this.showToast('No questions to export', 'error'); return; }

    const answersMap = await this.fetchAnswersMap(questions.map(q => q.id));
    const xml = this.importExportService.exportMoodleXML(questions, answersMap, this.categories());
    this.importExportService.downloadFile(xml, 'questions.xml', 'application/xml');
    this.showToast(`Exported ${questions.length} questions as Moodle XML`);
  }

  async exportGIFT() {
    const questions = this.selectedIds().size > 0
      ? this.myQuestions().filter(q => this.selectedIds().has(q.id))
      : this.myQuestions();

    if (questions.length === 0) { this.showToast('No questions to export', 'error'); return; }

    const answersMap = await this.fetchAnswersMap(questions.map(q => q.id));
    const gift = this.importExportService.exportGIFT(questions, answersMap);
    this.importExportService.downloadFile(gift, 'questions.gift.txt', 'text/plain');
    this.showToast(`Exported ${questions.length} questions as GIFT`);
  }

  onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.importText = e.target?.result as string || '';
      this.parseImportPreview();
    };
    reader.readAsText(file, 'UTF-8');
  }

  parseImportPreview() {
    this.importError.set(null);
    this.importPreview.set([]);

    if (!this.importText.trim()) return;

    try {
      let parsed: ParsedQuestion[] = [];
      switch (this.importFormat()) {
        case 'moodle_xml': parsed = this.importExportService.parseMoodleXML(this.importText); break;
        case 'gift':       parsed = this.importExportService.parseGIFT(this.importText); break;
        case 'aiken':      parsed = this.importExportService.parseAiken(this.importText); break;
      }

      if (parsed.length === 0) {
        this.importError.set('No questions found. Please check the format and try again.');
      } else {
        this.importPreview.set(parsed);
      }
    } catch (err: any) {
      this.importError.set(err.message || 'Failed to parse file.');
    }
  }

  async confirmImport() {
    const user = this.supabaseService.currentUser();
    if (!user) {
      this.showToast('Authentication error. Please refresh and log in again.', 'error');
      return;
    }

    const preview = this.importPreview();
    if (preview.length === 0) return;

    this.importLoading.set(true);
    this.importLogs.set(['Starting import...']);
    let imported = 0;
    let failed = 0;
    const categoryCache = new Map<string, string | null>();

    try {
      for (const pq of preview) {
        try {
          let categoryId = this.selectedCategoryId();
          
          // Handle Moodle categories if present
          if (pq.category_path) {
            if (categoryCache.has(pq.category_path)) {
              categoryId = categoryCache.get(pq.category_path)!;
            } else {
              this.importLogs.update(logs => [...logs, `Resolving path: ${pq.category_path}`]);
              categoryId = await this.getOrCreateCategoryByPath(pq.category_path);
              categoryCache.set(pq.category_path, categoryId);
            }
          }

          this.importLogs.update(logs => [...logs, `Importing question: ${pq.name}`]);
          const { data: newQ, error: qErr } = await this.supabaseService.db
            .from('questions')
            .insert({
              name: pq.name,
              question_text: pq.question_text,
              qtype: pq.qtype,
              default_grade: pq.default_grade,
              penalty: pq.penalty,
              general_feedback: pq.general_feedback,
              status: 'draft',
              version: 1,
              created_by: user.id,
              category_id: categoryId,
              metadata: {
                ...pq.metadata,
                author_name: this.supabaseService.currentUserName,
                modified_by: this.supabaseService.currentUserName,
                modified_at: new Date().toISOString(),
              }
            })
            .select()
            .single();

          if (qErr) throw qErr;

          if (pq.answers.length > 0) {
            await this.supabaseService.db
              .from('answers')
              .insert(pq.answers.map(a => ({
                question_id: newQ.id,
                answer_text: a.answer_text,
                fraction: a.fraction,
                feedback: a.feedback,
              })));
          }

          imported++;
        } catch (err: any) {
          failed++;
          this.importLogs.update(logs => [...logs, `ERROR (Question): ${err.message || 'Unknown error'}`]);
          console.error('Question import failed:', err);
        }
      }
    } catch (err: any) {
      this.importLogs.update(logs => [...logs, `FATAL ERROR: ${err.message}`]);
      this.showToast('Import failed: ' + err.message, 'error');
    } finally {
      this.importLoading.set(false);
      // Don't close modal if there were errors, so user can see logs
      if (failed === 0) {
        this.showImportModal.set(false);
        this.importPreview.set([]);
        this.importText = '';
      }

      // Final refresh of everything
      await this.loadCategories();
      await this.loadMyQuestions();

      const msg = failed > 0
        ? `Imported ${imported} questions (${failed} failed)`
        : `Successfully imported ${imported} questions!`;
      this.showToast(msg, failed > 0 ? 'info' : 'success');
    }
  }

  resetImport() {
    this.importPreview.set([]);
    this.importError.set(null);
    this.importText = '';
  }

  private async getOrCreateCategoryByPath(path: string): Promise<string | null> {
    const user = this.supabaseService.currentUser();
    if (!path || !user) return this.selectedCategoryId();

    // Remove $course$/top/, $cat1$/top/, etc. or just $course$/ prefixes
    const cleanPath = path.replace(/^\$[^$]+\$(\/top)?\/?/i, '');
    if (!cleanPath) return this.selectedCategoryId();

    const parts = cleanPath.split('/').filter(p => p.length > 0);
    let currentParentId: string | null = null;

    for (const part of parts) {
      let query = this.supabaseService.db
        .from('question_categories')
        .select('id')
        .eq('name', part);
      
      if (currentParentId) {
        query = query.eq('parent_id', currentParentId);
      } else {
        query = query.is('parent_id', null);
      }

      const { data: existing } = await query.maybeSingle();

      if (existing) {
        console.log(`[Import] Found existing category: ${part}`);
        currentParentId = existing.id;
      } else {
        console.log(`[Import] Creating category: ${part} under ${currentParentId || 'root'}`);
        // Create new category
        const insertOp: any = this.supabaseService.db
          .from('question_categories')
          .insert({
            name: part,
            parent_id: currentParentId,
            created_by: this.supabaseService.currentUser()?.id
          })
          .select('id')
          .single();
        
        const res = await insertOp;
        
        if (res.error) {
          console.error('[Import] Error creating category:', res.error);
          return currentParentId; // Fallback to parent
        }
        
        if (res.data) {
          currentParentId = (res.data as any).id;
          this.showToast(`New category: ${part}`, 'info');
        }
      }
    }

    return currentParentId;
  }

  // ====== CATEGORY MANAGEMENT ======

  async loadCategories() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    const { data, error } = await this.supabaseService.db
      .from('question_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) { console.error('Error loading categories:', error); return; }

    // Count questions per category
    const { data: qData } = await this.supabaseService.db
      .from('questions')
      .select('category_id')
      .eq('created_by', user.id)
      .is('deleted_at', null);

    const countMap = new Map<string, number>();
    qData?.forEach((q: any) => {
      if (q.category_id) countMap.set(q.category_id, (countMap.get(q.category_id) || 0) + 1);
    });

    // Build tree
    const all = (data || []).map((c: any) => ({ ...c, question_count: countMap.get(c.id) || 0, children: [] }));
    const rootCategories: Category[] = [];
    const map = new Map<string, Category>();
    all.forEach(c => map.set(c.id, c));
    all.forEach(c => {
      if (c.parent_id && map.has(c.parent_id)) {
        map.get(c.parent_id)!.children!.push(c);
      } else {
        rootCategories.push(c);
      }
    });

    this.categories.set(rootCategories);
  }

  selectCategory(id: string | null) {
    this.selectedCategoryId.set(id);
    this.currentPage.set(1);
    this.loadMyQuestions();
  }

  async addCategory() {
    if (!this.newCategoryName.trim()) return;
    const user = this.supabaseService.currentUser();
    if (!user) return;

    try {
      const { error } = await this.supabaseService.db
        .from('question_categories')
        .insert({
          name: this.newCategoryName.trim(),
          description: this.newCategoryDescription.trim() || null,
          parent_id: this.newCategoryParent,
          created_by: user.id,
          sort_order: this.categories().length
        });

      if (error) throw error;
      this.newCategoryName = '';
      this.newCategoryDescription = '';
      this.newCategoryParent = null;
      this.showToast('Category created!');
      await this.loadCategories();
    } catch (err: any) {
      this.showToast('Error creating category: ' + err.message, 'error');
    }
  }

  async saveEditCategory(cat: Category, newName: string, newDesc: string) {
    if (!newName.trim()) return;
    try {
      const { error } = await this.supabaseService.db
        .from('question_categories')
        .update({ name: newName.trim(), description: newDesc.trim() || null })
        .eq('id', cat.id);

      if (error) throw error;
      cat.isEditing = false;
      this.showToast('Category updated!');
      await this.loadCategories();
    } catch (err: any) {
      this.showToast('Error updating category: ' + err.message, 'error');
    }
  }

  initiateDeleteCategory(id: string) {
    // Find the full category object from the flat list
    const allCats = this.getFlatCategories();
    const cat = allCats.find(c => c.id === id);
    if (!cat) return;

    if ((cat.question_count && cat.question_count > 0) || (cat.children && cat.children.length > 0)) {
      this.categoryToDelete.set(cat as Category);
      this.deleteMoveToCategoryId.set(null); // Reset selection
    } else {
      // Empty category, delete immediately
      if (confirm(`Are you sure you want to delete the empty category "${cat.name}"?`)) {
        this.confirmDeleteCategory(cat as Category, null);
      }
    }
  }

  cancelDeleteCategory() {
    this.categoryToDelete.set(null);
    this.deleteMoveToCategoryId.set(null);
  }

  async confirmDeleteCategory(cat: Category = this.categoryToDelete()!, moveToId: string | null = this.deleteMoveToCategoryId()) {
    if (!cat) return;
    
    // If category has questions or children, ensure a destination is selected
    if ((cat.question_count && cat.question_count > 0) || (cat.children && cat.children.length > 0)) {
      if (!moveToId) {
        this.showToast('Please select a category to move items to.', 'error');
        return;
      }
      
      // Prevent moving to itself or its children (simplified check: just not itself for now)
      if (moveToId === cat.id) {
        this.showToast('Cannot move items to the category being deleted.', 'error');
        return;
      }
      
      this.loading.set(true);
      try {
        // Move questions
        if (cat.question_count && cat.question_count > 0) {
          const { error: moveErr } = await this.supabaseService.db
            .from('questions')
            .update({ category_id: moveToId })
            .eq('category_id', cat.id);
          if (moveErr) throw moveErr;
        }

        // Move child categories
        if (cat.children && cat.children.length > 0) {
          const { error: moveCatErr } = await this.supabaseService.db
            .from('question_categories')
            .update({ parent_id: moveToId })
            .eq('parent_id', cat.id);
          if (moveCatErr) throw moveCatErr;
        }
      } catch (err: any) {
        this.showToast('Error moving items: ' + err.message, 'error');
        this.loading.set(false);
        return;
      }
    } else {
        this.loading.set(true);
    }

    try {
      const { error } = await this.supabaseService.db
        .from('question_categories')
        .delete()
        .eq('id', cat.id);

      if (error) throw error;

      if (this.selectedCategoryId() === cat.id) {
        this.selectedCategoryId.set(moveToId || null);
      }
      this.showToast('Category deleted successfully', 'success');
      this.categoryToDelete.set(null);
      this.deleteMoveToCategoryId.set(null);
      await this.loadCategories();
      await this.loadMyQuestions();
    } catch (err: any) {
      this.showToast('Error deleting category: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  // Flatten categories for dropdowns
  getFlatCategories(cats: Category[] = this.categories(), depth: number = 0): any[] {
    let result: any[] = [];
    cats.forEach(c => {
      result.push({ ...c, depth });
      if (c.children?.length) {
        result = result.concat(this.getFlatCategories(c.children, depth + 1));
      }
    });
    return result;
  }

  get categoryOptions() {
    const opts = [
      { label: 'Top Level', value: 'null' }
    ];
    for (const cat of this.getFlatCategories()) {
      opts.push({ label: '—'.repeat(cat.depth) + ' ' + cat.name, value: cat.id });
    }
    return opts;
  }
}
