import { Component, inject, signal, computed, OnInit, effect, untracked, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule, NgIf, NgFor, DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { ImportExportService, ParsedQuestion } from '../services/import-export.service';
import { Router, RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { PaginatorModule } from 'primeng/paginator';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';

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
  created_by: string;
  metadata?: {
    author_id?: string;
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
  id_number?: string | null;
  assignment_completed_at?: string | null;
  penalty?: number;
  default_grade?: number;
  answers?: any[];
  sequenceNumber?: number;
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

@Component({
  selector: 'app-teacher-dashboard',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule, ReactiveFormsModule,
    SelectModule, TableModule, DialogModule, 
    ToastModule, PaginatorModule, DrawerModule, ButtonModule,
    MatIcon
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
  notificationService = inject(NotificationService);
  elementRef = inject(ElementRef);
  Math = Math;

  myQuestions = signal<Question[]>([]);
  assignedQuestions = signal<Question[]>([]);
  assistantSubmissions = signal<Question[]>([]);
  allQuestions = signal<Question[]>([]);
  loading = signal(true);
  showComments = signal(false);
  selectedQuestion = signal<Question | null>(null);
  @ViewChild('notificationContainer') notificationContainer?: ElementRef;
  
  showNotifications = signal(false);
  showAllNotifications = signal(false);
  allNotificationsFilter = signal<'all' | 'unread'>('all');
  dropdownFilter = signal<'all' | 'unread'>('unread');

  openAllNotifications() {
    this.showNotifications.set(false);
    this.notificationService.loadAllNotificationsArchive();
    this.showAllNotifications.set(true);
  }

  async onNotificationClick(n: any) {
    // 1. Mark notification as read
    await this.notificationService.markAsRead(n.id);
    
    // 2. Close notification dropdown and archive panel
    this.showNotifications.set(false);
    this.showAllNotifications.set(false);
    
    // 3. Navigate directly to the related question edit/view page if it exists
    if (n.metadata?.question_id) {
      this.router.navigate(['/teacher/edit-question', n.metadata.question_id]);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.notificationContainer) {
      const clickedInside = this.notificationContainer.nativeElement.contains(event.target);
      if (!clickedInside) {
        this.showNotifications.set(false);
      }
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent) {
    const activeEl = document.activeElement;
    const isEditing = activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.tagName === 'SELECT' || 
      activeEl.getAttribute('contenteditable') === 'true'
    );

    // Trigger on '/' key (when not editing) or Ctrl+K / Cmd+K
    if (
      (event.key === '/' && !isEditing) || 
      ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'k')
    ) {
      event.preventDefault();
      this.paletteQuery.set('');
      // Release/clear any active keyword search filters so we search over all questions
      this.filterKeyword.set('');
      this.debouncedKeyword.set('');
      this.showCommandPalette.set(true);
      
      // Auto focus palette input
      setTimeout(() => {
        const el = document.getElementById('palette-search-input');
        if (el) el.focus();
      }, 50);
    }

    // Close on Escape
    if (event.key === 'Escape' && this.showCommandPalette()) {
      this.showCommandPalette.set(false);
    }
  }

  executeCommand() {
    const query = this.paletteQuery().trim().toLowerCase();
    if (!query) return;

    // 1. Check if it's a page navigation command (starts with 'p' or 'page' followed by a number)
    const pageMatch = query.match(/^(?:p|page)\s*(\d+)$/i);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      const totalPages = Math.ceil(this.filteredQuestions().length / this.pageSize());
      if (pageNum >= 1 && pageNum <= totalPages) {
        this.currentPage.set(pageNum);
        // Scroll smoothly to the top of the window so they see the top of the new page's list
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        this.showToast(`Invalid page. Max page is ${totalPages}`, 'error');
      }
      this.showCommandPalette.set(false);
      return;
    }

    // 2. Check if it's a question number jump command (starts with 'q', '#', 'no', or just a raw number)
    const qNumMatch = query.match(/^(?:q|#|no\s*|no\.\s*)?(\d+)$/i);
    if (qNumMatch) {
      const qNum = parseInt(qNumMatch[1], 10);
      const list = this.filteredQuestions();
      const matchingIndex = list.findIndex(q => q.sequenceNumber === qNum);
      if (matchingIndex !== -1) {
        this.filterKeyword.set(`#${qNum}`);
        this.debouncedKeyword.set(`#${qNum}`);
        this.currentPage.set(1);
        this.showToast(`Found Question #${qNum}`, 'success');
      } else {
        this.showToast(`Question #${qNum} not found in this view`, 'error');
      }
      this.showCommandPalette.set(false);
      return;
    }

    // Otherwise, treat it as general keyword search
    this.filterKeyword.set(this.paletteQuery());
    this.debouncedKeyword.set(this.paletteQuery());
    this.currentPage.set(1);
    this.showToast(`Searching for "${this.paletteQuery()}"`, 'info');
    this.showCommandPalette.set(false);
  }

  selectPaletteMatch(q: Question) {
    this.showCommandPalette.set(false);
    
    // Resolve page
    const list = this.filteredQuestions();
    const idx = list.findIndex(item => item.id === q.id);
    if (idx !== -1) {
      this.currentPage.set(Math.floor(idx / this.pageSize()) + 1);
      this.lastEditedId.set(q.id);
      
      setTimeout(() => {
        const el = document.getElementById('question-card-' + q.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => this.lastEditedId.set(null), 3000);
        }
      }, 300);
    }
  }

  newCommentText = '';
  currentView = signal<'my' | 'assigned' | 'archive' | 'assistant_submissions'>('my');
  
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

  typeLabels: Record<string, { label: string; icon: string; description: string }> = {
    'multichoice': { 
      label: 'Multiple Choice', icon: '🔘', 
      description: 'Standard question with one or more correct answers chosen from a list.' 
    },
    'truefalse': { 
      label: 'True/False', icon: '✅', 
      description: 'Simple two-choice question for validating facts or statements.' 
    },
    'shortanswer': { 
      label: 'Short Answer', icon: '✏️', 
      description: 'Accepts a single word or short phrase. Can be case-sensitive.' 
    },
    'numerical': { 
      label: 'Numerical', icon: '🔢', 
      description: 'Specifically for math answers. Supports tolerances and units.' 
    },
    'essay': { 
      label: 'Essay', icon: '📝', 
      description: 'Long-form text response. Requires manual grading by the teacher.' 
    },
    'match': { 
      label: 'Matching', icon: '🔗', 
      description: 'Students must match a list of sub-questions with a list of answers.' 
    },
    'calculated': { 
      label: 'Calculated', icon: '🧮', 
      description: 'Math questions where numbers are randomly generated from a dataset.' 
    },
    'calculatedmulti': { 
      label: 'Calc. Multichoice', icon: '🧮', 
      description: 'Calculated question presented as multiple choice options.' 
    },
    'calculatedsimple': { 
      label: 'Calc. Simple', icon: '🧮', 
      description: 'Easier way to create calculated questions without full datasets.' 
    },
    'ddwtos': { 
      label: 'Drag into Text', icon: '📋', 
      description: 'Missing words in a text passage are filled by dragging "pills" into gaps.' 
    },
    'ddimageortext': { 
      label: 'Drag onto Image', icon: '🖼️', 
      description: 'Drag images or text labels onto predefined drop zones on a background image.' 
    },
    'ddmarker': { 
      label: 'Drag Matching', icon: '📌', 
      description: 'Markers are placed onto a background image. Good for anatomy or maps.' 
    },
    'ordering': { 
      label: 'Ordering', icon: '↕️', 
      description: 'Students must arrange items in the correct logical or chronological sequence.' 
    },
    'coderunner': { 
      label: 'CodeRunner', icon: '💻', 
      description: 'Programming questions where code is automatically executed and tested.' 
    },
    'gapselect': {
      label: 'Select Missing Words', icon: '🔠',
      description: 'Students fill in missing words by selecting them from a dropdown menu.'
    },
    'multianswer': {
      label: 'Embedded Answers (Cloze)', icon: '🧩',
      description: 'Complex question type with embedded multiple choice, short answer, or numerical responses.'
    },
    'random': {
      label: 'Random Question', icon: '🎲',
      description: 'A placeholder for a random question selected from a specific category.'
    },
    'multichoiceanswernone': {
      label: 'All-or-Nothing MCQ', icon: '❗',
      description: 'Multiple Choice where full credit is given ONLY if all correct options are chosen.'
    }
  };

  availableQtypes = computed(() => {
    return Object.keys(this.typeLabels).sort();
  });

  // Selection & Pagination
  selectedIds = signal<Set<string>>(new Set());
  currentPage = signal(1);
  pageSize = signal(10);
  lastEditedId = signal<string | null>(null);
  showCommandPalette = signal(false);
  paletteQuery = signal('');
  paletteMatches = computed(() => {
    const query = this.paletteQuery().trim().toLowerCase();
    if (!query || query.startsWith('p') || query.startsWith('page')) return [];

    const list = this.filteredQuestions();
    return list.filter(q => {
      const nameMatch = q.name?.toLowerCase().includes(query);
      const textMatch = q.question_text?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().includes(query);
      const seqMatch = q.sequenceNumber?.toString() === query.replace(/#|no\.|no/g, '');
      return nameMatch || textMatch || seqMatch;
    }).slice(0, 5);
  });
  notification = signal<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  // Categories
  categories = signal<Category[]>([]);
  selectedCategoryId = signal<string | null>(null);
  showCategoryPanel = signal(false);
  showTypeHelp = signal(false);
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
  importFileBuffer: ArrayBuffer | null = null;

  // Computed properties for template
  filteredQuestions = computed(() => {
    const authored = this.allQuestions();
    const assigned = this.assignedQuestions();
    const assistant = this.assistantSubmissions();
    
    // Combine authored, assigned, and assistant questions, deduplicate by ID
    const combinedMap = new Map<string, Question>();
    authored.forEach(q => combinedMap.set(q.id, q));
    assigned.forEach(q => combinedMap.set(q.id, q));
    assistant.forEach(q => combinedMap.set(q.id, q));
    const allQs = Array.from(combinedMap.values());

    const view = this.currentView();
    const user = this.supabaseService.currentUser();
    if (!user) return [];

    // 1. Filter for latest versions in family
    const familyMap = new Map<string, Question>();
    allQs.forEach(q => {
      const familyId = q.parent_id || q.id;
      const existing = familyMap.get(familyId);
      if (!existing || q.version > existing.version) {
        familyMap.set(familyId, q);
      }
    });

    // 2. Populate allVersions and create result array
    let result = Array.from(familyMap.values()).map(q => {
      const familyId = q.parent_id || q.id;
      return {
        ...q,
        allVersions: allQs.filter(v => (v.parent_id || v.id) === familyId)
                         .sort((a, b) => b.version - a.version)
      };
    });

    // 3. Filter by View
    if (view === 'assigned') {
      const assigned = this.assignedQuestions();
      result = result.filter(q => {
        const familyId = q.parent_id || q.id;
        return assigned.some(aq => {
          const aqFamilyId = aq.parent_id || aq.id;
          return aq.id === q.id || aqFamilyId === familyId;
        });
      });
    } else if (view === 'assistant_submissions') {
      const assistant = this.assistantSubmissions();
      result = result.filter(q => {
        const familyId = q.parent_id || q.id;
        return q.status === 'pending_teacher_review' && assistant.some(aq => {
          const aqFamilyId = aq.parent_id || aq.id;
          return aq.id === q.id || aqFamilyId === familyId;
        });
      });
    } else if (view === 'archive') {
      // Archive is different - it shows deleted questions. 
      // Only show soft-deleted questions owned by the current user to prevent other users' archived items from leaking.
      result = result.filter(q => q.deleted_at !== null && (q.created_by === user.id || q.metadata?.author_id === user.id));
    } else {
      // 'my' view: Author is me
      result = result.filter(q => q.created_by === user.id || q.metadata?.author_id === user.id);
    }

    // Sort the view questions so their sequence number matches the visual sort order
    result = [...result].sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at).getTime();
      const dateB = new Date(b.updated_at || b.created_at).getTime();
      return this.sortOrder() === 'asc' ? dateA - dateB : dateB - dateA;
    });

    // Add sequence number (1-based index) to each question
    result = result.map((q, idx) => ({
      ...q,
      sequenceNumber: idx + 1
    }));

    // 4. Apply search and UI filters (since they might not be fully applied in DB for assigned questions)
    const kw = this.debouncedKeyword()?.toLowerCase()?.trim();
    const status = this.filterStatus();
    const type = this.filterType();
    const catId = this.selectedCategoryId();
    const dateFrom = this.filterDateFrom() ? new Date(this.filterDateFrom()).getTime() : null;
    const dateTo = this.filterDateTo() ? new Date(this.filterDateTo()).getTime() : null;

    return result.filter(q => {
      // Keyword filter
      if (kw) {
        const nameMatch = q.name?.toLowerCase().includes(kw);
        // Strip HTML tags from question_text before matching so plain-text searches work
        const plainText = q.question_text?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        const textMatch = plainText?.includes(kw);
        const idMatch = q.id_number?.toLowerCase().includes(kw);
        
        // Sequence number match (e.g. if keyword is "45", "no. 45", "no45", or "#45")
        const parsedSeq = parseInt(kw.replace(/no\.|no|#| /g, ''), 10);
        const seqMatch = !isNaN(parsedSeq) && q.sequenceNumber === parsedSeq;

        if (!nameMatch && !textMatch && !idMatch && !seqMatch) return false;
      }

      // Status filter
      if (status && q.status !== status) return false;

      // Type filter
      if (type && q.qtype !== type) return false;

      // Category filter
      if (catId && q.category_id !== catId) return false;

      // Date range filter
      if (dateFrom || dateTo) {
        const updated = new Date(q.updated_at || q.created_at).getTime();
        if (dateFrom && updated < dateFrom) return false;
        if (dateTo && updated > dateTo) return false;
      }

      return true;
    });
  });

  paginatedQuestions = computed(() => {
    const questions = this.filteredQuestions();
    const size = this.pageSize();
    const totalPages = Math.ceil(questions.length / size) || 1;
    
    // Automatically clamp current page to valid range
    let page = this.currentPage();
    if (page > totalPages) {
      page = totalPages;
      untracked(() => this.currentPage.set(totalPages));
    } else if (page < 1) {
      page = 1;
      untracked(() => this.currentPage.set(1));
    }

    const from = (page - 1) * size;
    const to = from + size;
    return questions.slice(from, to);
  });
  
  categoryOptions = computed(() => {
    const cat = this.categoryToDelete();
    if (!cat) return [];
    
    // Get all descendant IDs of cat.id to prevent circular movement
    const descendants = new Set<string>();
    const getDescendants = (parentId: string) => {
      this.categories()
        .filter(c => c.parent_id === parentId)
        .forEach(c => {
          descendants.add(c.id);
          getDescendants(c.id);
        });
    };
    getDescendants(cat.id);
    
    // Filter out the category itself and its descendants
    return this.categories()
      .filter(c => c.id !== cat.id && !descendants.has(c.id))
      .map(c => ({ label: c.name, value: c.id }));
  });

  pendingAssignmentsCount = computed(() => {
    return this.assignedQuestions().filter(q => !q.assignment_completed_at).length;
  });

  pendingAssistantSubmissionsCount = computed(() => {
    return this.assistantSubmissions().length;
  });

  constructor() {
    // Restore dashboard state from sessionStorage before registering effects
    this.loadDashboardState();

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

    // Effect to auto-save filters and current page state to sessionStorage
    effect(() => {
      const state = {
        currentView: this.currentView(),
        currentPage: this.currentPage(),
        pageSize: this.pageSize(),
        filterHidden: this.filterHidden(),
        filterType: this.filterType(),
        filterDateFrom: this.filterDateFrom(),
        filterDateTo: this.filterDateTo(),
        filterStatus: this.filterStatus(),
        filterKeyword: this.filterKeyword(),
        selectedCategoryId: this.selectedCategoryId(),
        sortField: this.sortField(),
        sortOrder: this.sortOrder()
      };
      sessionStorage.setItem('teacher_dashboard_state', JSON.stringify(state));
    });

    // Main data loading effect
    // We explicitly list dependencies to be clear about what triggers a reload
    effect(() => {
      const user = this.supabaseService.currentUser();
      if (!user) return;

      // Dependency tracking
      this.currentView();
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

    // Automatically redirect admin users to their correct workspace
    effect(() => {
      const role = this.supabaseService.currentUserRole();
      if (role === 'admin') {
        untracked(() => {
          this.router.navigate(['/admin']);
        });
      }
    });
  }

  loadDashboardState() {
    const saved = sessionStorage.getItem('teacher_dashboard_state');
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.currentView) this.currentView.set(state.currentView);
        if (state.currentPage) this.currentPage.set(state.currentPage);
        if (state.pageSize) this.pageSize.set(state.pageSize);
        if (state.filterHidden !== undefined) this.filterHidden.set(state.filterHidden);
        if (state.filterType !== undefined) this.filterType.set(state.filterType);
        if (state.filterDateFrom !== undefined) this.filterDateFrom.set(state.filterDateFrom);
        if (state.filterDateTo !== undefined) this.filterDateTo.set(state.filterDateTo);
        if (state.filterStatus !== undefined) this.filterStatus.set(state.filterStatus);
        if (state.filterKeyword !== undefined) {
          this.filterKeyword.set(state.filterKeyword);
          this.debouncedKeyword.set(state.filterKeyword);
        }
        if (state.selectedCategoryId !== undefined) this.selectedCategoryId.set(state.selectedCategoryId);
        if (state.sortField) this.sortField.set(state.sortField);
        if (state.sortOrder) this.sortOrder.set(state.sortOrder);
      } catch (e) {
        console.error('Error loading dashboard state', e);
      }
    }
  }

  ngOnInit() {
    // Initial load handled by effects
    this.notificationService.loadNotifications();
  }

  onKeywordChange(value: string) {
    this.filterKeyword.set(value);
    this.keywordSubject.next(value);
  }

  isAssignedToMe(q: Question): boolean {
    const familyId = q.parent_id || q.id;
    return this.assignedQuestions().some(aq => {
      const aqFamilyId = aq.parent_id || aq.id;
      return aq.id === q.id || aqFamilyId === familyId;
    });
  }

  myQuestionsCount = signal(0);

  async loadMyQuestionsCount() {
    const user = this.supabaseService.currentUser();
    if (!user) return;
    try {
      const { count } = await this.supabaseService.db
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .or(`created_by.eq.${user.id},metadata->>author_id.eq.${user.id}`);
      
      this.myQuestionsCount.set(count || 0);
    } catch (err) {
      console.error('Failed to load my questions count:', err);
    }
  }

  async loadMyQuestions() {
    const user = this.supabaseService.currentUser();
    if (!user) return;

    // Use untracked for state changes to avoid triggering recursive effects
    untracked(() => this.loading.set(true));

    try {
      // Badge count is now handled by computed myQuestionsCount signal

      let query = this.supabaseService.db
        .from('questions')
        .select('*, answers(*)', { count: 'exact' });

      // If no category is selected, show only my questions
      // If a category is selected, we show questions in that category
      if (!this.selectedCategoryId()) {
        query = query.or(`created_by.eq.${user.id},metadata->>author_id.eq.${user.id}`);
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
      // If it is a sequence number search (like #1, q1, no. 1), do NOT filter by keyword in DB,
      // because sequence numbers are dynamic frontend indices and handled locally in computed filteredQuestions
      const isSeqQuery = kw && /^(?:#|q|no\s*|no\.\s*)\d+$/i.test(kw.trim());
      
      if (kw && !isSeqQuery) {
        const kwPattern = `%${kw}%`;
        // Use separate .or() with properly quoted ilike filters so keywords with
        // spaces or special characters are handled correctly by PostgREST
        query = query.or(`name.ilike."${kwPattern}",question_text.ilike."${kwPattern}"`);
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
        .order(this.sortField(), { ascending: this.sortOrder() === 'asc' });

      if (error) throw error;

      untracked(() => {
        const questions = (data as Question[]).filter(q => q.name !== '__SYSTEM_USER_RECORDS__');
        this.allQuestions.set(questions);
        this.myQuestions.set(questions); // Keep for legacy if needed, but computed uses allQuestions
        this.totalCount.set(count || 0);
        this.loadMyQuestionsCount();
      });

      this.loadAssignedQuestions();
      this.loadAssistantSubmissions();

      // Wait for all loads to finish, then resolve the correct page and scroll to the last edited question
      setTimeout(() => {
        const lastId = sessionStorage.getItem('last_edited_question_id');
        if (lastId) {
          const list = this.filteredQuestions();
          const matchingIndex = list.findIndex(q => {
            if (q.id === lastId) return true;
            if (q.allVersions?.some(v => v.id === lastId)) return true;
            return false;
          });

          if (matchingIndex !== -1) {
            untracked(() => {
              const targetPage = Math.floor(matchingIndex / this.pageSize()) + 1;
              this.currentPage.set(targetPage);
              this.lastEditedId.set(lastId);
            });
            
            // Wait for DOM to render the new page
            setTimeout(() => {
              const el = document.getElementById('question-card-' + lastId);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Remove highlight after 3 seconds
                setTimeout(() => {
                  this.lastEditedId.set(null);
                  sessionStorage.removeItem('last_edited_question_id');
                }, 3000);
              }
            }, 300);
          }
        }
      }, 600);

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
      .select('question_id, completed_at')
      .eq('assigned_to_id', user.id);

    if (assignments && assignments.length > 0) {
      const ids = assignments.map(a => a.question_id);
      const { data: qs } = await this.supabaseService.db
        .from('questions')
        .select('*, answers(*)')
        .in('id', ids)
        .is('deleted_at', null);
      
      const questionsWithMeta = (qs as any[] || []).map(q => {
        const assignment = assignments.find(a => a.question_id === q.id);
        return {
          ...q,
          assignment_completed_at: assignment?.completed_at
        };
      });

      untracked(() => this.assignedQuestions.set(questionsWithMeta));
    } else {
      untracked(() => this.assignedQuestions.set([]));
    }
  }

  async loadAssistantSubmissions() {
    const role = this.supabaseService.currentUserRole();
    if (role !== 'teacher') {
      untracked(() => this.assistantSubmissions.set([]));
      return;
    }

    try {
      let query = this.supabaseService.db
        .from('questions')
        .select('*, answers(*)')
        .eq('status', 'pending_teacher_review')
        .is('deleted_at', null);

      // Filter by teacher's subject specialization/categories
      const user = this.supabaseService.currentUser();
      if (user) {
        const { data: profile } = await this.supabaseService.db
          .from('profiles')
          .select('specialization')
          .eq('id', user.id)
          .maybeSingle();

        console.log('[DEBUG loadAssistantSubmissions] teacher profile specialization:', profile?.specialization);

        if (profile && profile.specialization && profile.specialization.length > 0) {
          const specIds = profile.specialization;
          const allowedIds = new Set<string>();

          // Helper to recursively collect all child categories
          const collectIds = (parentId: string) => {
            allowedIds.add(parentId);
            this.categories()
              .filter(c => c.parent_id === parentId)
              .forEach(c => collectIds(c.id));
          };
          specIds.forEach((id: string) => collectIds(id));

          console.log('[DEBUG loadAssistantSubmissions] allowedCategoryIds:', Array.from(allowedIds));

          if (allowedIds.size > 0) {
            query = query.in('category_id', Array.from(allowedIds));
          }
        } else {
          console.log('[DEBUG loadAssistantSubmissions] No specialization set — showing ALL subjects');
        }
      }

      const { data, error } = await query;

      console.log('[DEBUG loadAssistantSubmissions] raw from DB:', data?.length, data?.map((q: any) => ({ id: q.id, name: q.name, status: q.status, category_id: q.category_id, version: q.version, parent_id: q.parent_id })));

      if (!error && data) {
        let filteredQuestions = data as Question[];
        
        if (data.length > 0) {
          const questionIds = data.map((q: any) => q.id);
          const parentIds = data.map((q: any) => q.parent_id).filter(Boolean);
          const allFamilyIds = [...new Set([...questionIds, ...parentIds])];

          // Fetch any newer versions of these questions in the database
          const { data: newerVersions } = await this.supabaseService.db
            .from('questions')
            .select('parent_id, version')
            .in('parent_id', allFamilyIds);

          console.log('[DEBUG loadAssistantSubmissions] newerVersions:', newerVersions);

          filteredQuestions = (data as Question[]).filter((q: any) => {
            const familyId = q.parent_id || q.id;
            // Filter out if there is a version in newerVersions with parent_id = familyId and version > q.version
            const hasNewer = newerVersions?.some((nv: any) => nv.parent_id === familyId && nv.version > q.version);
            console.log(`[DEBUG] Q[${q.name}] v${q.version} family=${familyId} hasNewer=${hasNewer}`);
            return !hasNewer;
          });
        }

        console.log('[DEBUG loadAssistantSubmissions] final shown count:', filteredQuestions.length);
        untracked(() => this.assistantSubmissions.set(filteredQuestions));
      }
    } catch (err) {
      console.error('Error loading assistant submissions:', err);
    }
  }

  async loadCategories() {
    const user = this.supabaseService.currentUser();
    const role = this.supabaseService.currentUserRole();
    if (!user) return;

    let query = this.supabaseService.db
      .from('question_categories')
      .select('*, questions(count)')
      .is('questions.deleted_at', null)
      .order('sort_order', { ascending: true });

    // Best Practice: Assistant teachers only see their own or global categories to reduce clutter.
    // Teachers and admins see all categories to fully collaborate on peer reviews and submissions.
    if (role === 'assistant_teacher') {
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

  startEditCategory(cat: Category) {
    this.editingCategory.set({ ...cat });
  }

  updateEditingCategoryName(name: string) {
    const current = this.editingCategory();
    if (current) {
      this.editingCategory.set({ ...current, name });
    }
  }

  cancelEditCategory() {
    this.editingCategory.set(null);
  }

  async saveCategoryName() {
    const current = this.editingCategory();
    if (!current || !current.name.trim()) {
      this.cancelEditCategory();
      return;
    }

    const original = this.categories().find(c => c.id === current.id);
    if (original && original.name.trim() === current.name.trim()) {
      this.cancelEditCategory();
      return;
    }

    const { data, error } = await this.supabaseService.db
      .from('question_categories')
      .update({ name: current.name.trim() })
      .eq('id', current.id)
      .select();

    if (error) {
      this.showToast('Failed to rename category: ' + error.message, 'error');
    } else if (!data || data.length === 0) {
      this.showToast('Failed to rename category. You may not have permission.', 'error');
    } else {
      this.showToast('Category renamed successfully', 'success');
      this.loadCategories();
    }
    this.cancelEditCategory();
  }

  async initiateDeleteCategory(catId: string) {
    const cat = this.categories().find(c => c.id === catId);
    if (!cat) return;

    // Check if there are child categories
    const childCats = this.categories().filter(c => c.parent_id === cat.id);

    if (cat.question_count === 0 && childCats.length === 0) {
      if (confirm(`Are you sure you want to delete category "${cat.name}"?`)) {
        // Nullify any hidden questions (e.g., soft-deleted or drafts) to avoid foreign key violations
        await this.supabaseService.db
          .from('questions')
          .update({ category_id: null })
          .eq('category_id', cat.id);

        const { error } = await this.supabaseService.db
          .from('question_categories')
          .delete()
          .eq('id', cat.id);

        if (error) {
          this.showToast('Failed to delete category: ' + error.message, 'error');
        } else {
          this.showToast('Category deleted successfully', 'success');
          this.loadCategories();
        }
      }
    } else {
      // Not empty, show the move & delete dialog
      this.deleteMoveToCategoryId.set(null);
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
      // Move all questions in this category (including active and soft-deleted ones)
      const { error: moveError } = await this.supabaseService.db
        .from('questions')
        .update({ category_id: this.deleteMoveToCategoryId() })
        .eq('category_id', cat.id);
      
      if (moveError) {
        console.error('Move Questions Error:', moveError);
        this.showToast('Failed to move questions: ' + moveError.message, 'error');
        return;
      }
    } else {
      // Fallback: nullify category_id of lingering questions
      await this.supabaseService.db
        .from('questions')
        .update({ category_id: null })
        .eq('category_id', cat.id);
    }

    const { error } = await this.supabaseService.db
      .from('question_categories')
      .delete()
      .eq('id', cat.id);

    if (error) {
      this.showToast('Failed to delete category: ' + error.message, 'error');
    } else {
      this.showToast('Category deleted successfully', 'success');
      this.categoryToDelete.set(null);
      this.loadCategories();
    }
  }

  async deleteQuestion(id: string, name?: string) {
    if (!confirm(`Are you sure you want to delete "${name || 'this question'}"?`)) return;

    // Check current status before attempting delete
    const { data: qData } = await this.supabaseService.db
      .from('questions')
      .select('status, created_by')
      .eq('id', id)
      .maybeSingle();

    const currentUser = this.supabaseService.currentUser();

    // Block: question is not owned by this user at all
    if (qData && qData.created_by !== currentUser?.id) {
      this.showToast(
        'Cannot delete this question',
        'error',
        'This question was created by another user. You can only delete questions you created yourself.'
      );
      return;
    }

    // If the question is in pending_teacher_review, we must recall it first (reset to draft)
    // so that RLS allows the creator to update/delete it.
    if (qData?.status === 'pending_teacher_review') {
      const { data: recallData, error: recallErr } = await this.supabaseService.db
        .from('questions')
        .update({ status: 'draft' })
        .eq('id', id)
        .select();

      if (recallErr || !recallData || recallData.length === 0) {
        this.showToast(
          'Cannot delete: question is under review',
          'error',
          'This question has been submitted for teacher review and could not be recalled. Ask your teacher to return it to draft, or wait for the review to complete.'
        );
        return;
      }
      // Retract notifications
      await this.notificationService.retractReviewNotifications(id);
    }

    const { data: uData, error } = await this.supabaseService.db
      .from('questions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) {
      this.showToast('Delete failed', 'error', error.message);
    } else if (!uData || uData.length === 0) {
      this.showToast(
        'Delete failed',
        'error',
        'The system could not delete this question. It may be in a status that prevents deletion (e.g. approved or under admin review).'
      );
    } else {
      this.showToast('Question moved to trash', 'success');
      this.loadMyQuestions();
      this.loadCategories();
    }
  }

  async restoreQuestion(id: string, name?: string) {
    if (!confirm(`Are you sure you want to restore "${name || 'this question'}"?`)) return;

    const { data: uData, error } = await this.supabaseService.db
      .from('questions')
      .update({ deleted_at: null })
      .eq('id', id)
      .select();

    if (error) {
      this.showToast(error.message, 'error');
    } else if (!uData || uData.length === 0) {
      this.showToast('Restore failed. You may not have permission to restore this question.', 'error');
    } else {
      this.showToast('Question restored successfully', 'success');
      this.loadMyQuestions();
      this.loadCategories();
    }
  }

  async purgeQuestion(questionOrId: Question | string, name?: string) {
    let id: string;
    let displayName: string;
    let parentId: string | null = null;

    if (typeof questionOrId === 'string') {
      id = questionOrId;
      displayName = name || 'this question';
      
      // Fetch the question to get its parent_id
      const { data: qData } = await this.supabaseService.db
        .from('questions')
        .select('id, parent_id, name')
        .eq('id', id)
        .maybeSingle();
      
      if (qData) {
        parentId = qData.parent_id;
        displayName = qData.name || displayName;
      }
    } else {
      id = questionOrId.id;
      displayName = questionOrId.name;
      parentId = questionOrId.parent_id;
    }

    if (!confirm(`Are you sure you want to PERMANENTLY delete "${displayName}" and all its versions? This action cannot be undone.`)) return;

    const familyId = parentId || id;

    // Fetch all versions in this family from the database to delete them in correct order
    const { data: familyVersions, error: fetchErr } = await this.supabaseService.db
      .from('questions')
      .select('id, parent_id, version, status, created_by')
      .or(`parent_id.eq.${familyId},id.eq.${familyId}`);

    if (fetchErr) {
      this.showToast(`Failed to fetch question versions: ${fetchErr.message}`, 'error');
      return;
    }

    if (!familyVersions || familyVersions.length === 0) {
      // If none found in DB, just try to delete the ID itself in case of RLS view restrictions
      const { error: delErr } = await this.supabaseService.db
        .from('questions')
        .delete()
        .eq('id', id);
      if (delErr) {
        this.showToast(delErr.message, 'error');
      } else {
        this.showToast('Question permanently deleted', 'success');
        this.loadMyQuestions();
        this.loadCategories();
      }
      return;
    }

    // Recall any versions in pending_teacher_review owned by the current user
    // (RLS blocks DELETE on submitted questions — must reset to draft first)
    const currentUser = this.supabaseService.currentUser();
    for (const ver of familyVersions) {
      if (ver.status === 'pending_teacher_review' && ver.created_by === currentUser?.id) {
        await this.supabaseService.db
          .from('questions')
          .update({ status: 'draft' })
          .eq('id', ver.id);
        await this.notificationService.retractReviewNotifications(ver.id);
      }
    }

    // Sort descending by version (highest version first, parent version v1 last)
    const sortedVersions = [...familyVersions].sort((a, b) => b.version - a.version);

    let succeededCount = 0;
    let skippedCount = 0;
    let failedErrors: string[] = [];

    for (const ver of sortedVersions) {
      // Skip versions not owned by the current user — they belong to a reviewer who branched
      if (ver.created_by !== currentUser?.id) {
        skippedCount++;
        continue;
      }

      // 1. Delete associated answers
      await this.supabaseService.db
        .from('answers')
        .delete()
        .eq('question_id', ver.id);

      // 2. Delete associated assignments
      await this.supabaseService.db
        .from('assignments')
        .delete()
        .eq('question_id', ver.id);

      // 3. Delete notifications
      await this.supabaseService.db
        .from('notifications')
        .delete()
        .eq('metadata->>question_id', ver.id);

      // 4. Delete the question version itself
      const { data, error: delErr } = await this.supabaseService.db
        .from('questions')
        .delete()
        .eq('id', ver.id)
        .select();

      if (delErr) {
        failedErrors.push(`v${ver.version}: ${delErr.message}`);
      } else if (data && data.length > 0) {
        succeededCount++;
      } else {
        failedErrors.push(`v${ver.version}: No permission to delete this version.`);
      }
    }

    if (failedErrors.length > 0) {
      if (succeededCount > 0) {
        this.showToast(
          `Partially deleted (${succeededCount} of ${succeededCount + failedErrors.length} versions)`,
          'info',
          'Some versions were reviewed by another teacher and cannot be removed. Your original version has been deleted.'
        );
      } else {
        this.showToast(
          'Cannot permanently delete this question',
          'error',
          failedErrors[0] + ' The question may have been reviewed and a new version created by someone else. Try moving it to trash instead.'
        );
      }
    } else if (succeededCount === 0 && skippedCount > 0) {
      this.showToast(
        'Cannot delete: not your question',
        'error',
        'All versions of this question are owned by another user (e.g. a teacher who reviewed it). You do not have permission to permanently delete them.'
      );
    } else {
      this.showToast('Question permanently deleted', 'success');
    }

    this.loadMyQuestions();
    this.loadCategories();
  }

  async withdrawFromReview(q: Question) {
    const { data: uData, error } = await this.supabaseService.db
      .from('questions')
      .update({ status: 'draft' })
      .eq('id', q.id)
      .select();

    if (error) {
      this.showToast(error.message, 'error');
    } else if (!uData || uData.length === 0) {
      this.showToast('Withdraw failed. You may not have permission to modify this question.', 'error');
    } else {
      q.status = 'draft';
      this.showToast('Withdrawn to draft', 'success');
      
      // Retract/Delete the active review notifications from database
      await this.notificationService.retractReviewNotifications(q.id);

      this.loadMyQuestions();
      this.loadAssignedQuestions();
      this.loadAssistantSubmissions();
    }
  }

  async updateQuestionName(q: Question, newName: string) {
    if (!newName.trim() || newName === q.name) {
      q.isEditingName = false;
      return;
    }

    const { data: uData, error } = await this.supabaseService.db
      .from('questions')
      .update({ name: newName.trim() })
      .eq('id', q.id)
      .select();

    if (error) {
      this.showToast(error.message, 'error');
    } else if (!uData || uData.length === 0) {
      this.showToast('Name update failed. You may not have permission to modify this question.', 'error');
    } else {
      q.name = newName.trim();
      this.showToast('Name updated', 'success');
    }
    q.isEditingName = false;
  }

  async updateQuestionStatus(q: Question, statusOrEvent: any) {
    const status = typeof statusOrEvent === 'string' ? statusOrEvent : statusOrEvent.target.value;
    const user = this.supabaseService.currentUser();
    const originalStatus = q.status;

    let commentText = '';
    let updatedMetadata = q.metadata || {};

    if (status === 'draft' && originalStatus === 'pending_teacher_review') {
      const comment = prompt('Please enter feedback/comments for returning this question to the assistant:');
      if (comment === null) {
        // User cancelled, reset dropdown
        this.loadMyQuestions();
        this.loadAssignedQuestions();
        this.loadAssistantSubmissions();
        return;
      }
      commentText = comment.trim();
      const newComment = {
        user: this.supabaseService.currentUserName,
        text: commentText || 'Returned to draft by teacher.',
        date: new Date().toISOString()
      };
      updatedMetadata = {
        ...updatedMetadata,
        comments: [...(updatedMetadata.comments || []), newComment]
      };
    } else if (status === 'rejected') {
      const comment = prompt('Please enter feedback/comments for rejecting this question:');
      if (comment === null) {
        // User cancelled, reset dropdown
        this.loadMyQuestions();
        this.loadAssignedQuestions();
        this.loadAssistantSubmissions();
        return;
      }
      commentText = comment.trim();
      const newComment = {
        user: this.supabaseService.currentUserName,
        text: commentText || 'Question rejected.',
        date: new Date().toISOString()
      };
      updatedMetadata = {
        ...updatedMetadata,
        comments: [...(updatedMetadata.comments || []), newComment]
      };
    }

    let targetId = q.id;
    let nextVersion = q.version;
    let newQInserted = false;

    // Check if we need to create a new version (Version Branching)
    const isOwner = user && (q.created_by === user.id || q.metadata?.author_id === user.id);
    const forceNewVersion = !isOwner;

    if (forceNewVersion && user) {
      const parentId = q.parent_id || q.id;
      
      // Find the maximum version in this family to ensure we always increment
      const { data: latestRecords } = await this.supabaseService.db
        .from('questions')
        .select('version')
        .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
        .order('version', { ascending: false })
        .limit(1);

      const maxVersion = latestRecords?.[0]?.version || q.version || 1;
      nextVersion = maxVersion + 1;
      
      // Prepare metadata for new version
      const currentMetadata = q.metadata || {};
      const newMetadata = {
        ...currentMetadata,
        ...updatedMetadata,
        author_id: currentMetadata.author_id || q.created_by,
        author_name: currentMetadata.author_name || (q as any).author_name || '',
        author_email: currentMetadata.author_email || (q as any).author_email || '',
        modified_by: this.supabaseService.currentUserName,
        modified_by_email: user.email,
        modified_at: new Date().toISOString()
      };

      // Insert new version
      const { data: newQ, error: nError } = await this.supabaseService.db
        .from('questions')
        .insert({
          name: q.name,
          question_text: q.question_text,
          general_feedback: q.general_feedback || null,
          qtype: q.qtype,
          version: nextVersion,
          status: status,
          parent_id: parentId,
          created_by: user.id,
          category_id: q.category_id || null,
          penalty: q.penalty !== undefined ? q.penalty : null,
          default_grade: q.default_grade !== undefined ? q.default_grade : 1,
          metadata: newMetadata
        })
        .select()
        .single();

      if (nError) {
        this.showToast(nError.message, 'error');
        this.loadMyQuestions();
        this.loadAssignedQuestions();
        this.loadAssistantSubmissions();
        return;
      }

      targetId = newQ.id;
      newQInserted = true;
      updatedMetadata = newMetadata;

      // Copy answers of the old question to the new question
      const { data: answersData } = await this.supabaseService.db
        .from('answers')
        .select('*')
        .eq('question_id', q.id);

      if (answersData && answersData.length > 0) {
        const answersToInsert = answersData.map(ans => ({
          question_id: targetId,
          answer_text: ans.answer_text,
          fraction: ans.fraction,
          feedback: ans.feedback,
          x: ans.x,
          y: ans.y
        }));
        const { error: ansError } = await this.supabaseService.db
          .from('answers')
          .insert(answersToInsert);
        if (ansError) {
          console.error('Error copying answers for new version:', ansError.message);
        }
      }
    } else {
      // Regular in-place update for owner
      const { data: uData, error } = await this.supabaseService.db
        .from('questions')
        .update({ status, metadata: updatedMetadata })
        .eq('id', q.id)
        .select();

      if (error) {
        this.showToast(error.message, 'error');
        this.loadMyQuestions();
        this.loadAssignedQuestions();
        this.loadAssistantSubmissions();
        return;
      } else if (!uData || uData.length === 0) {
        this.showToast('Update failed. You may not have permission to modify this question.', 'error');
        this.loadMyQuestions();
        this.loadAssignedQuestions();
        this.loadAssistantSubmissions();
        return;
      }
    }

    // Common logic for UI and signal updates
    const completedAt = (status === 'approved' || status === 'rejected') ? new Date().toISOString() : q.assignment_completed_at;
    
    // Create the updated representation object for reactive signals
    const updatedQuestionObj: Question = {
      ...q,
      id: targetId,
      version: nextVersion,
      status: status,
      metadata: updatedMetadata,
      assignment_completed_at: completedAt,
      created_by: user ? user.id : q.created_by
    };

    if (status === 'approved' || status === 'rejected') {
      updatedQuestionObj.assignment_completed_at = completedAt;
    }

    this.showToast('Status updated', 'success');

    // Update all source signals synchronously to guarantee instant UI updates & Angular Signal reactivity
    this.allQuestions.update(list => 
      list.map(item => item.id === q.id ? updatedQuestionObj : item)
    );
    this.myQuestions.update(list => 
      list.map(item => item.id === q.id ? updatedQuestionObj : item)
    );
    this.assignedQuestions.update(list => 
      list.map(item => item.id === q.id ? updatedQuestionObj : item)
    );
    this.assistantSubmissions.update(list => 
      list.filter(item => item.id !== q.id || status === 'pending_teacher_review')
    );

    // If updated back to draft or rejected, retract active review notifications
    if (status === 'draft' || status === 'rejected') {
      await this.notificationService.retractReviewNotifications(q.id);
    }

    // Notify teachers when assistant teacher submits for teacher review
    if (status === 'pending_teacher_review') {
      this.notificationService.notifyTeachers(
        'submitted_for_teacher_review',
        'Question Submitted for Teacher Review',
        `${this.supabaseService.currentUserName} submitted "${q.name}" for teacher review.`,
        { question_id: targetId, author_name: this.supabaseService.currentUserName }
      );
    }

    // Notify admins when teacher submits for review
    if (status === 'pending_review') {
      this.notificationService.notifyAdmins(
        'submitted_for_review',
        'Question Submitted for Review',
        `${this.supabaseService.currentUserName} submitted "${q.name}" for review.`,
        { question_id: targetId, author_name: this.supabaseService.currentUserName }
      );

      if (originalStatus === 'pending_teacher_review' && q.metadata?.author_id) {
        this.notificationService.createNotification(
          q.metadata.author_id,
          'teacher_approved',
          'Question Approved by Teacher',
          `Your question "${q.name}" was approved and submitted to admins by ${this.supabaseService.currentUserName}.`,
          { question_id: targetId }
        );
      }
    }

    // Notify assistant if teacher rejected & returned to draft
    if (status === 'draft' && originalStatus === 'pending_teacher_review' && q.metadata?.author_id) {
      this.notificationService.createNotification(
        q.metadata.author_id,
        'teacher_rejected',
        'Question Returned to Draft',
        `Your question "${q.name}" was returned to draft by ${this.supabaseService.currentUserName}: ${commentText || 'Returned to draft.'}`,
        { question_id: targetId }
      );
    }

    // If it's a final review status (approved/rejected), mark the assignment as completed
    if (user && (status === 'approved' || status === 'rejected')) {
      await this.supabaseService.db
        .from('assignments')
        .update({ completed_at: new Date().toISOString() })
        .eq('question_id', q.id)
        .eq('assigned_to_id', user.id)
        .is('completed_at', null);
      
      // Automatically clear (mark read) the task notification for this teacher
      this.notificationService.markReviewNotificationsAsRead(q.id, user.id);
    }
    
    this.loadMyQuestions();
    this.loadAssignedQuestions();
    this.loadAssistantSubmissions();
  }

  async switchVersion(q: Question, versionId: string) {
    if (!versionId || versionId === q.id) return;
    this.router.navigate(['/teacher/edit-question', versionId]);
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

    const user = this.supabaseService.currentUser();
    if (!user) return;

    const newComment = {
      user: this.supabaseService.currentUserName,
      text: this.newCommentText,
      date: new Date().toISOString()
    };

    const isOwner = q.created_by === user.id;

    if (isOwner) {
      const metadata = {
        ...(q.metadata || {}),
        comments: [...(q.metadata?.comments || []), newComment]
      };

      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ metadata })
        .eq('id', q.id);

      if (error) {
        this.showToast(error.message, 'error');
        return;
      }

      this.newCommentText = '';
      const updatedQuestionObj = { ...q, metadata };
      if (this.selectedQuestion()?.id === q.id) {
        this.selectedQuestion.set(updatedQuestionObj);
      }

      this.allQuestions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );
      this.myQuestions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );
      this.assignedQuestions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );
      this.assistantSubmissions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );

      this.loadMyQuestions();
      this.loadAssignedQuestions();
      this.loadAssistantSubmissions();
    } else {
      const parentId = q.parent_id || q.id;

      // Find the maximum version in this family to ensure we always increment
      const { data: latestRecords } = await this.supabaseService.db
        .from('questions')
        .select('version')
        .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
        .order('version', { ascending: false })
        .limit(1);

      const maxVersion = latestRecords?.[0]?.version || q.version || 1;
      const nextVersion = maxVersion + 1;

      // Prepare metadata for new version
      const currentMetadata = q.metadata || {};
      const newMetadata = {
        ...currentMetadata,
        comments: [...(q.metadata?.comments || []), newComment],
        author_id: currentMetadata.author_id || q.created_by,
        author_name: currentMetadata.author_name || (q as any).author_name || '',
        author_email: currentMetadata.author_email || (q as any).author_email || '',
        modified_by: this.supabaseService.currentUserName,
        modified_by_email: user.email,
        modified_at: new Date().toISOString()
      };

      // Insert new version
      const { data: newQ, error: nError } = await this.supabaseService.db
        .from('questions')
        .insert({
          name: q.name,
          question_text: q.question_text,
          general_feedback: q.general_feedback || null,
          qtype: q.qtype,
          version: nextVersion,
          status: q.status, // preserve original status
          parent_id: parentId,
          created_by: user.id,
          category_id: q.category_id || null,
          penalty: q.penalty !== undefined ? q.penalty : null,
          default_grade: q.default_grade !== undefined ? q.default_grade : 1,
          metadata: newMetadata
        })
        .select()
        .single();

      if (nError) {
        this.showToast(nError.message, 'error');
        return;
      }

      const targetId = newQ.id;

      // Copy answers of the old question to the new question
      const { data: answersData } = await this.supabaseService.db
        .from('answers')
        .select('*')
        .eq('question_id', q.id);

      if (answersData && answersData.length > 0) {
        const answersToInsert = answersData.map(ans => ({
          question_id: targetId,
          answer_text: ans.answer_text,
          fraction: ans.fraction,
          feedback: ans.feedback,
          x: ans.x,
          y: ans.y
        }));
        const { error: ansError } = await this.supabaseService.db
          .from('answers')
          .insert(answersToInsert);
        if (ansError) {
          console.error('Error copying answers for new version:', ansError.message);
        }
      }

      this.newCommentText = '';

      const updatedQuestionObj: Question = {
        ...q,
        id: targetId,
        version: nextVersion,
        metadata: newMetadata,
        created_by: user.id
      };

      if (this.selectedQuestion()?.id === q.id) {
        this.selectedQuestion.set(updatedQuestionObj);
      }

      this.allQuestions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );
      this.myQuestions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );
      this.assignedQuestions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );
      this.assistantSubmissions.update(list => 
        list.map(item => item.id === q.id ? updatedQuestionObj : item)
      );

      this.loadMyQuestions();
      this.loadAssignedQuestions();
      this.loadAssistantSubmissions();
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
      } else {
        if (file.name.endsWith('.gift')) {
          this.importFormat.set('gift');
        } else if (file.name.endsWith('.aiken')) {
          this.importFormat.set('aiken');
        }
        this.importText = new TextDecoder().decode(this.importFileBuffer!);
        this.parseImportPreview();
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
        const giftQs = this.importExportService.parseGIFT(this.importText);
        const smartQs = this.importExportService.parseSmart(this.importText);
        questions = giftQs.length >= smartQs.length ? giftQs : smartQs;
      } else if (this.importFormat() === 'aiken') {
        const aikenQs = this.importExportService.parseAiken(this.importText);
        const smartQs = this.importExportService.parseSmart(this.importText);
        questions = smartQs.length >= aikenQs.length ? smartQs : aikenQs;
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

    let targetCategoryId = this.importTargetCategoryId();

    // Default fallbacks to prevent RLS policy violation due to null category_id insertion
    if (!targetCategoryId) {
      targetCategoryId = this.selectedCategoryId();
    }
    if (!targetCategoryId && this.flatCategories().length > 0) {
      targetCategoryId = this.flatCategories()[0].id;
    }

    // Create a new category first if the user filled in the "Or Create New" input box
    const newCatName = this.importNewCategoryName()?.trim();
    if (!targetCategoryId && !newCatName) {
      this.showToast('No subject category selected or available. Please configure or select a category before importing.', 'error');
      this.importLoading.set(false);
      return;
    }

    if (newCatName) {
      try {
        const { data: newCat, error: catErr } = await this.supabaseService.db
          .from('question_categories')
          .insert({
            name: newCatName,
            created_by: user.id,
            sort_order: this.categories().length
          })
          .select()
          .single();

        if (catErr) throw catErr;
        
        targetCategoryId = newCat.id;
        console.log('Automatically created category during import:', newCatName, targetCategoryId);
      } catch (err: any) {
        console.error('Failed to create category during import:', err);
        this.showToast('Failed to create new category: ' + (err.message || err), 'error');
        this.importLoading.set(false);
        return;
      }
    }

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
            category_id: targetCategoryId,
            metadata: {
              author_id: user.id,
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

        // Sync tags in the tags and question_tags relational tables
        const importTags = q.metadata?.['tags'] || [];
        if (importTags.length > 0) {
          await this.supabaseService.syncQuestionTags(newQ.id, importTags);
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

  showToast(message: string, type: 'success' | 'error' | 'info' = 'success', detail?: string) {
    // Use PrimeNG MessageService for rich toasts (supports summary + detail)
    const severityMap = { success: 'success', error: 'error', info: 'info' };
    this.messageService.add({
      severity: severityMap[type],
      summary: message,
      detail: detail,
      life: type === 'error' ? 6000 : 4000,
    });
    // Also keep the legacy signal for any template bindings
    this.notification.set({ message, type });
    setTimeout(() => this.notification.set(null), type === 'error' ? 6000 : 4000);
  }

  toggleSelection(id: string) {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
  }

  toggleSelectAll(event: any) {
    if (event.target.checked) {
      this.selectedIds.set(new Set(this.filteredQuestions().map(q => q.id)));
    } else {
      this.selectedIds.set(new Set());
    }
  }

  isAllSelected() {
    return this.filteredQuestions().length > 0 && this.selectedIds().size === this.filteredQuestions().length;
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
    // Always select exactly what is visible on screen — no separate DB query
    // This prevents count mismatches between visible rows and selected IDs
    const visibleIds = this.filteredQuestions().map(q => q.id);
    this.selectedIds.set(new Set(visibleIds));
    this.showToast(`Selected all ${visibleIds.length} questions`, 'success');
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

    let succeeded = 0;
    let failed = 0;
    const reasons: string[] = [];

    for (const id of ids) {
      // If question is pending_teacher_review, recall it first so RLS allows the update
      const { data: qData } = await this.supabaseService.db
        .from('questions')
        .select('status, created_by')
        .eq('id', id)
        .maybeSingle();

      const currentUser = this.supabaseService.currentUser();
      if (qData && qData.created_by !== currentUser?.id) {
        failed++;
        reasons.push('One or more questions were created by another user.');
        continue;
      }

      if (qData?.status === 'pending_teacher_review') {
        const { data: recallData } = await this.supabaseService.db
          .from('questions')
          .update({ status: 'draft' })
          .eq('id', id)
          .select();
        if (recallData && recallData.length > 0) {
          await this.notificationService.retractReviewNotifications(id);
        } else {
          failed++;
          reasons.push('A question is under review and could not be recalled.');
          continue;
        }
      }

      const { data } = await this.supabaseService.db
        .from('questions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select();

      if (data && data.length > 0) {
        succeeded++;
      } else {
        failed++;
        reasons.push('A question could not be moved to trash (permission denied).');
      }
    }

    if (succeeded > 0) {
      this.showToast(`Moved ${succeeded} question(s) to trash`, 'success');
    }
    if (failed > 0) {
      const uniqueReasons = [...new Set(reasons)];
      this.showToast(
        `${failed} question(s) could not be deleted`,
        'error',
        uniqueReasons.join(' ') || 'Check that you own all selected questions and none are under review.'
      );
    }
    this.clearSelection();
    this.loadMyQuestions();
    this.loadCategories();
  }

  async bulkPurgeQuestions() {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;

    if (!confirm(`Are you sure you want to PERMANENTLY delete ${ids.length} selected questions? This action cannot be undone.`)) return;

    untracked(() => this.loading.set(true));

    const currentUser = this.supabaseService.currentUser();
    // Track which family IDs we've already processed to avoid double-deleting
    const processedFamilies = new Set<string>();

    try {
      let totalSucceeded = 0;
      let totalFailed = 0;

      for (const id of ids) {
        // Fetch family versions (include status + created_by for permission checks)
        const { data: qData } = await this.supabaseService.db
          .from('questions')
          .select('id, parent_id')
          .eq('id', id)
          .maybeSingle();

        const familyId = qData ? (qData.parent_id || qData.id) : id;

        // Skip if we already processed this family
        if (processedFamilies.has(familyId)) continue;
        processedFamilies.add(familyId);

        const { data: familyVersions } = await this.supabaseService.db
          .from('questions')
          .select('id, parent_id, version, status, created_by')
          .or(`parent_id.eq.${familyId},id.eq.${familyId}`);

        if (familyVersions && familyVersions.length > 0) {
          // First pass: recall any pending versions we own
          for (const ver of familyVersions) {
            if (ver.status === 'pending_teacher_review' && ver.created_by === currentUser?.id) {
              await this.supabaseService.db
                .from('questions')
                .update({ status: 'draft' })
                .eq('id', ver.id);
              await this.notificationService.retractReviewNotifications(ver.id);
            }
          }

          // Second pass: delete only versions we own (skip reviewer-branched copies)
          const sortedVersions = [...familyVersions]
            .filter(ver => ver.created_by === currentUser?.id)
            .sort((a, b) => b.version - a.version);

          let familySucceeded = false;

          for (const ver of sortedVersions) {
            await this.supabaseService.db.from('answers').delete().eq('question_id', ver.id);
            await this.supabaseService.db.from('assignments').delete().eq('question_id', ver.id);
            await this.supabaseService.db.from('notifications').delete().eq('metadata->>question_id', ver.id);

            const { data, error } = await this.supabaseService.db
              .from('questions')
              .delete()
              .eq('id', ver.id)
              .select();

            if (!error && data && data.length > 0) {
              familySucceeded = true;
            }
          }

          if (familySucceeded) {
            totalSucceeded++;
          } else {
            totalFailed++;
          }
        } else {
          totalFailed++;
        }
      }

      if (totalSucceeded > 0) {
        this.showToast(`Permanently deleted ${totalSucceeded} question(s)`, 'success');
      }
      if (totalFailed > 0) {
        this.showToast(
          `${totalFailed} question(s) could not be deleted`,
          'error',
          'Some questions belong to other users or all their versions are owned by a reviewer. Only your own question versions can be permanently removed.'
        );
      }

      this.clearSelection();
      this.loadMyQuestions();
      this.loadCategories();
    } catch (err: any) {
      this.showToast(`Error during bulk purge: ${err.message || err}`, 'error');
    } finally {
      untracked(() => this.loading.set(false));
    }
  }
}
