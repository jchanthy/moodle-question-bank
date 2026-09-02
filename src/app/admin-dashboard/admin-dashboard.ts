import { Component, inject, signal, computed, OnInit, effect, untracked, HostListener, ElementRef, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, NgIf, NgFor, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { ImportExportService, ParsedQuestion } from '../services/import-export.service';
import { Router, RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ToastModule } from 'primeng/toast';
import { PaginatorModule } from 'primeng/paginator';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

interface Question {
  id: string;
  name: string;
  question_text: string;
  qtype: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  version: number;
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
    comments?: { user: string; text: string; date: string }[];
    tags?: string[];
  };
  created_at: string;
  updated_at?: string;
  created_by: string;
  category_id: string | null;
  parent_id: string | null;
  deleted_at?: string | null;
  id_number?: string | null;
  answers?: any[];
  sequenceNumber?: number;
}

interface Teacher {
  id: string;
  name: string;
  email?: string;
  role?: string;
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
  imports: [
    CommonModule, RouterModule, FormsModule,
    AutoCompleteModule, ToastModule, PaginatorModule, ButtonModule,
    DialogModule, MatIcon
  ],
  providers: [MessageService],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css'
})
export class AdminDashboardComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  router = inject(Router);
  messageService = inject(MessageService);
  notificationService = inject(NotificationService);
  elementRef = inject(ElementRef);
  
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
      
      // Clear standard search fields instantly
      this.filterSearch.set('');
      this.debouncedSearch.set('');
      this.searchSubject.next('');
      
      this.showCommandPalette.set(true);
      
      // Auto focus palette input
      setTimeout(() => {
        const el = document.getElementById('palette-search-input');
        if (el) el.focus();
      }, 50);
    }

    // Close on Escape or clear search text filter
    if (event.key === 'Escape') {
      if (this.showCommandPalette()) {
        this.showCommandPalette.set(false);
      } else {
        this.filterSearch.set('');
        this.debouncedSearch.set('');
        this.searchSubject.next('');
        this.currentPage.set(1);
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          (activeEl as HTMLElement).blur();
        }
      }
    }
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    // Only trigger infinite scroll if we are looking at the questions tab view
    if (this.currentView() !== 'questions') return;

    const threshold = 300; // px from bottom of the page
    const position = window.scrollY + window.innerHeight;
    const height = document.documentElement.scrollHeight;

    if (position >= height - threshold) {
      const totalMatching = this.filteredQuestions().length;
      const currentlyLoaded = this.currentPage() * this.pageSize();
      
      if (currentlyLoaded < totalMatching) {
        // Load the next page/chunk of questions dynamically!
        this.currentPage.update(val => val + 1);
      }
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
        const targetQ = list[matchingIndex];
        
        // Apply filter keyword search specifically to that question number
        this.filterSearch.set(`#${qNum}`);
        this.debouncedSearch.set(`#${qNum}`);
        this.searchSubject.next(`#${qNum}`);
        this.currentPage.set(1);
        this.scrollToQuestion(targetQ.id);
        
        this.showToast(`Found Question #${qNum}`, 'success');
      } else {
        this.showToast(`Question #${qNum} not found in this view`, 'error');
      }
      this.showCommandPalette.set(false);
      return;
    }

    // Otherwise, treat it as general keyword search
    this.filterSearch.set(this.paletteQuery());
    this.debouncedSearch.set(this.paletteQuery());
    this.searchSubject.next(this.paletteQuery());
    this.currentPage.set(1);
    this.showToast(`Searching for "${this.paletteQuery()}"`, 'info');
    this.showCommandPalette.set(false);
  }

  scrollToQuestion(qId: string) {
    this.lastEditedId.set(qId);
    
    // We execute scrolling twice to ensure perfect centering regardless of rendering or layout delays!
    const performScroll = () => {
      const el = document.getElementById('question-card-' + qId);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    };

    // First snappy jump
    setTimeout(performScroll, 100);
    // Second deep centering check to account for asynchronous template reflows/choices loading
    setTimeout(performScroll, 450);

    // Clear highlight after 3 seconds
    setTimeout(() => {
      if (this.lastEditedId() === qId) {
        this.lastEditedId.set(null);
        sessionStorage.removeItem('last_edited_question_id');
      }
    }, 3000);
  }

  selectPaletteMatch(q: Question) {
    this.showCommandPalette.set(false);
    
    // Resolve page
    const list = this.filteredQuestions();
    const idx = list.findIndex(item => item.id === q.id);
    if (idx !== -1) {
      this.currentPage.set(Math.floor(idx / this.pageSize()) + 1);
      this.scrollToQuestion(q.id);
    }
  }

  importExportService = inject(ImportExportService);
  today = new Date();

  // Raw data (unfiltered)
  allPendingQuestions = signal<Question[]>([]);
  allApprovedQuestions = signal<Question[]>([]);
  allRejectedQuestions = signal<Question[]>([]);
  allDraftQuestions = signal<Question[]>([]);
  allQuestions = signal<Question[]>([]);
  allAssignments = signal<{question_id: string, assigned_to_id: string}[]>([]);

  loading = signal(true);
  questionTypeCounts = signal<TypeCount[]>([]);
  totalQuestions = signal(0);
  // Tabs
  activeTab = signal<'pending' | 'approved' | 'rejected' | 'draft'>(
    (sessionStorage.getItem('admin_active_tab') as any) || 'pending'
  );
  showTypeHelp = signal(false);

  // Import properties
  showImportModal = signal(false);
  importFormat = signal<'moodle_xml' | 'gift' | 'aiken' | 'word_docx'>('moodle_xml');
  importText = '';
  importFileBuffer: ArrayBuffer | null = null;
  importPreview = signal<ParsedQuestion[]>([]);
  importLoading = signal(false);
  importLogs = signal<string[]>([]);
  importTargetCategoryId = signal<string | null>(null);
  importNewCategoryName = signal<string>('');
  importError = signal<string | null>(null);
  importedGIFTText = signal<string>('');

  // Inline Editing variables
  editingTextQuestionId = signal<string | null>(null);
  editingTextValue = '';
  editingChoiceId = signal<string | null>(null);
  editingChoiceText = '';
  savingInline = signal(false);

  // View state
  currentView = signal<'questions' | 'team' | 'report' | 'categories' | 'tags'>(
    (sessionStorage.getItem('admin_current_view') as any) || 'questions'
  );
  selectedTeacherId = signal<string | null>(null);
  tagsList = signal<any[]>([]);
  loadingTags = signal(false);

  // Tag View Filters & Sorting
  filterTagsSearch = signal<string>('');
  filterTagsStatus = signal<'all' | 'active' | 'unused'>('all');
  sortTagsBy = signal<'count_desc' | 'count_asc' | 'name_asc' | 'name_desc'>('count_desc');

  filteredTagsList = computed(() => {
    const list = this.tagsList();
    const search = this.filterTagsSearch().toLowerCase().trim();
    const status = this.filterTagsStatus();
    const sort = this.sortTagsBy();

    let result = [...list];

    if (search) {
      result = result.filter(tag => tag.name.toLowerCase().includes(search));
    }

    if (status === 'active') {
      result = result.filter(tag => tag.count > 0);
    } else if (status === 'unused') {
      result = result.filter(tag => tag.count === 0);
    }

    if (sort === 'count_desc') {
      result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    } else if (sort === 'count_asc') {
      result.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
    } else if (sort === 'name_asc') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'name_desc') {
      result.sort((a, b) => b.name.localeCompare(a.name));
    }

    return result;
  });


  // Computed signal for Drawer visibility
  isDrawerVisible = computed(() => !!this.selectedTeacherId());
  closeDrawer() {
    this.selectedTeacherId.set(null);
  }

  // Filter state
  filterTeacher = signal(sessionStorage.getItem('admin_filter_teacher') || '');
  filterQtype = signal(sessionStorage.getItem('admin_filter_qtype') || '');
  filterCategory = signal(sessionStorage.getItem('admin_filter_category') || '');
  filterSearch = signal(sessionStorage.getItem('admin_filter_search') || '');

  // Debounced filter states to prevent 503 errors
  debouncedSearch = signal(sessionStorage.getItem('admin_filter_search') || '');
  private searchSubject = new Subject<string>();

  showCommandPalette = signal(false);
  paletteQuery = signal('');
  lastEditedId = signal<string | null>(null);
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

  protected readonly Math = Math;

  // Pagination
  currentPage = signal(1);
  pageSize = signal(10);
  totalCounts = computed(() => {
    const allQs = this.allQuestions();
    
    // 1. Filter for latest versions in family
    const familyMap = new Map<string, Question>();
    allQs.forEach(q => {
      const familyId = q.parent_id || q.id;
      const existing = familyMap.get(familyId);
      if (!existing || q.version > existing.version) {
        familyMap.set(familyId, q);
      }
    });
    
    let list = Array.from(familyMap.values());
    
    // 2. Apply filters (except status and search sequence number)
    if (this.filterQtype()) list = list.filter(q => q.qtype === this.filterQtype());
    if (this.filterCategory()) list = list.filter(q => q.category_id === this.filterCategory());
    if (this.filterTeacher()) {
      const teacher = this.filterTeacher().toLowerCase();
      list = list.filter(q => q.metadata?.author_name?.toLowerCase().includes(teacher));
    }
    
    const selectedTags = this.filterSelectedTags();
    if (selectedTags && selectedTags.length > 0) {
      list = list.filter(q => {
        const qTags = (q.metadata?.tags || []).map((t: string) => t.toLowerCase());
        return selectedTags.every(tag => qTags.includes(tag.toLowerCase()));
      });
    }
    
    const search = this.debouncedSearch().toLowerCase().trim();
    if (search) {
      list = list.filter(q => {
        const nameMatch = q.name.toLowerCase().includes(search);
        const textMatch = q.question_text.toLowerCase().includes(search);
        return nameMatch || textMatch;
      });
    }

    return {
      pending: list.filter(q => q.status === 'pending_review').length,
      approved: list.filter(q => q.status === 'approved').length,
      rejected: list.filter(q => q.status === 'rejected').length,
      draft: list.filter(q => q.status === 'draft').length
    };
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
  editingCategoryId = signal<string | null>(null);

  // Unique teachers from the database (Source of Truth)
  availableTeachers = computed(() => {
    const qMeta = this.allQuestionsMeta();
    const authorIds = new Set<string>();
    
    qMeta.forEach(q => {
      const authorId = q.metadata?.author_id || q.created_by;
      if (authorId) {
        authorIds.add(authorId);
      }
    });

    return [...this.allRegisteredTeachers()]
      .filter(t => 
        authorIds.has(t.id) && 
        t.role !== 'admin' && 
        !t.name.toLowerCase().includes('admin') && 
        !t.email?.toLowerCase().includes('admin')
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Filter questions for the selected teacher (both authored and reviewed)
  selectedTeacherTasks = computed(() => {
    const tid = this.selectedTeacherId();
    if (!tid) return [];
    
    const allQs = this.allQuestions();
    const assignments = this.allAssignments();

    // Deduplicate by family to only show latest version of each task
    const familyMap = new Map<string, Question>();
    allQs.forEach(q => {
      const familyId = q.parent_id || q.id;
      const existing = familyMap.get(familyId);
      if (!existing || q.version > existing.version) {
        familyMap.set(familyId, q);
      }
    });

    const uniqueQs = Array.from(familyMap.values());

    return uniqueQs.filter(q => {
      // Check authorship: either database created_by OR metadata author_id
      const isAuthor = q.created_by === tid || q.metadata?.author_id === tid;
      
      // Check assignments: look for assignments to ANY version of the family
      const isReviewer = assignments.some(a => 
        (a.question_id === q.id || (q.parent_id && a.question_id === q.parent_id) || (a.question_id === q.parent_id)) && 
        a.assigned_to_id === tid
      );
      
      return isAuthor || isReviewer;
    })
      .map(q => {
        const isAuthor = q.created_by === tid || q.metadata?.author_id === tid;
        const isReviewer = assignments.some(a => 
          (a.question_id === q.id || (q.parent_id && a.question_id === q.parent_id)) && 
          a.assigned_to_id === tid
        );

        return {
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
          parent_id: q.parent_id,
          isAuthor,
          isReviewer,
          isPaid: !!q.metadata?.paid_at
        };
      })
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
    const teachers = this.allRegisteredTeachers().filter(t => t.role !== 'admin');
    const assignments = this.allAssignments();
    const allQs = this.allQuestions();
    
    // Create a map of question IDs for quick lookup
    const qMap = new Map<string, any>();
    allQs.forEach(q => qMap.set(q.id, q));

    return teachers.map(t => {
      // 1. Authored stats - Deduplicate by family to count unique questions
      const myAuthoredRaw = allQs.filter(q => q.created_by === t.id || q.metadata?.author_id === t.id);
      const familyMap = new Map<string, Question>();
      myAuthoredRaw.forEach(q => {
        const familyId = q.parent_id || q.id;
        const existing = familyMap.get(familyId);
        if (!existing || q.version > existing.version) {
          familyMap.set(familyId, q);
        }
      });
      const authored = Array.from(familyMap.values());
      
      // 2. Review stats (from the assignments table)
      const myAssignments = assignments.filter(a => a.assigned_to_id === t.id);
      const assigned = myAssignments.map(a => {
        // Find the latest version of the question for this assignment
        const versions = allQs.filter(v => v.id === a.question_id || v.parent_id === a.question_id);
        return versions.sort((a, b) => b.version - a.version)[0];
      }).filter(q => !!q);
      
      return {
        ...t,
        stats: {
          authoredReady: authored.filter(q => q.status === 'approved').length,
          authoredPending: authored.filter(q => q.status !== 'approved').length,
          reviewsCompleted: assigned.filter(q => q.status === 'approved' || q.status === 'rejected').length,
          reviewsPending: assigned.filter(q => q.status !== 'approved' && q.status !== 'rejected').length
        }
      };
    })
    .filter(t => {
      const activity = t.stats.authoredReady + t.stats.authoredPending + t.stats.reviewsCompleted + t.stats.reviewsPending;
      return activity > 0;
    })
    .sort((a, b) => {
      const activityA = a.stats.authoredReady + a.stats.authoredPending + a.stats.reviewsCompleted + a.stats.reviewsPending;
      const activityB = b.stats.authoredReady + b.stats.authoredPending + b.stats.reviewsCompleted + b.stats.reviewsPending;
      return activityB - activityA;
    });
  });
 
  selectedTeacherPerformance = computed(() => {
    const tid = this.selectedTeacherId();
    if (!tid) return null;
    return this.teacherPerformance().find(tp => tp.id === tid);
  });

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
    },
    'gapfill': { 
      label: 'Gap Fill', icon: '📝', 
      description: 'Fill-in-the-blank style questions. Words inside brackets [like this] become gaps. Supports drag-drop, dropdown, or text input.' 
    }
  };

  constructor() {
    // Setup debouncing for search
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed()
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
        } else if (view === 'tags') {
          this.loadTagsData();
        }
      });
    });

    // Effect for counts and metadata — runs once when role is confirmed
    let initDone = false;
    effect(() => {
      const userRole = this.supabaseService.currentUserRole();
      if (userRole !== 'admin') return;
      if (initDone) return;
      initDone = true;

      untracked(async () => {
        this.loading.set(true);
        try {
          await Promise.all([
            this.loadAllQuestionsData(),
            this.loadQuestionTypeCounts(),
            this.loadCategories(),
            this.loadTeachers(),
            this.loadAssignments(),
            this.loadTagsData()
          ]);
          this.notificationService.loadNotifications();
        } catch (e) {
          console.error('Error loading admin dashboard:', e);
        } finally {
          untracked(() => this.loading.set(false));
        }
      });
    });

    // Automatically redirect teacher users to their correct workspace
    effect(() => {
      const role = this.supabaseService.currentUserRole();
      if (role === 'teacher') {
        untracked(() => {
          this.router.navigate(['/teacher']);
        });
      }
    });

    // Effect to persist filters
    effect(() => {
      sessionStorage.setItem('admin_filter_teacher', this.filterTeacher());
      sessionStorage.setItem('admin_filter_qtype', this.filterQtype());
      sessionStorage.setItem('admin_filter_category', this.filterCategory());
      sessionStorage.setItem('admin_filter_search', this.filterSearch());
      sessionStorage.setItem('admin_filter_selected_tags', JSON.stringify(this.filterSelectedTags()));
      sessionStorage.setItem('admin_active_tab', this.activeTab());
      sessionStorage.setItem('admin_current_view', this.currentView());
    });
  }

  startEditingText(q: Question) {
    this.editingTextQuestionId.set(q.id);
    let text = q.question_text || '';
    if (text.toLowerCase().startsWith('<p>') && text.toLowerCase().endsWith('</p>')) {
      text = text.substring(3, text.length - 4);
    }
    this.editingTextValue = text;
  }

  getTextareaRows(text: string, defaultRows: number = 4): number {
    if (!text) return defaultRows;
    const lines = text.split('\n').length;
    const wrappedLines = Math.ceil(text.length / 50);
    return Math.max(lines, wrappedLines, defaultRows);
  }

  async saveInlineText(q: Question) {
    if (!this.editingTextValue.trim()) return;
    this.savingInline.set(true);
    try {
      let finalValue = this.editingTextValue.trim();
      const original = q.question_text || '';
      if (original.toLowerCase().startsWith('<p>') && original.toLowerCase().endsWith('</p>')) {
        finalValue = `<p>${finalValue}</p>`;
      }

      const { error } = await this.supabaseService.db
        .from('questions')
        .update({ question_text: finalValue, updated_at: new Date().toISOString() })
        .eq('id', q.id);

      if (error) throw error;

      // Update in memory state
      const updated = this.allQuestions().map(item => {
        if (item.id === q.id) {
          return { ...item, question_text: finalValue };
        }
        return item;
      });
      this.allQuestions.set(updated);
      this.showToast('Question text updated successfully', 'success');
      this.editingTextQuestionId.set(null);
    } catch (e: any) {
      this.showToast(e.message, 'error');
    } finally {
      this.savingInline.set(false);
    }
  }

  startEditingChoice(ans: any) {
    this.editingChoiceId.set(ans.id);
    let text = ans.answer_text || '';
    if (text.toLowerCase().startsWith('<p>') && text.toLowerCase().endsWith('</p>')) {
      text = text.substring(3, text.length - 4);
    }
    this.editingChoiceText = text;
  }

  async saveChoiceText(ans: any, q: Question) {
    if (!this.editingChoiceText.trim()) return;
    this.savingInline.set(true);
    try {
      let finalValue = this.editingChoiceText.trim();
      const original = ans.answer_text || '';
      if (original.toLowerCase().startsWith('<p>') && original.toLowerCase().endsWith('</p>')) {
        finalValue = `<p>${finalValue}</p>`;
      }

      const { error } = await this.supabaseService.db
        .from('answers')
        .update({ answer_text: finalValue })
        .eq('id', ans.id);

      if (error) throw error;

      // Update in memory state
      const updatedQuestions = this.allQuestions().map(item => {
        if (item.id === q.id && item.answers) {
          const updatedAnswers = item.answers.map((a: any) => {
            if (a.id === ans.id) {
              return { ...a, answer_text: finalValue };
            }
            return a;
          });
          return { ...item, answers: updatedAnswers };
        }
        return item;
      });
      this.allQuestions.set(updatedQuestions);
      this.showToast('Choice text updated successfully', 'success');
      this.editingChoiceId.set(null);
    } catch (e: any) {
      this.showToast(e.message, 'error');
    } finally {
      this.savingInline.set(false);
    }
  }

  onBlurText() {
    setTimeout(() => {
      if (!this.savingInline()) {
        this.editingTextQuestionId.set(null);
      }
    }, 200);
  }

  onBlurChoice() {
    setTimeout(() => {
      if (!this.savingInline()) {
        this.editingChoiceId.set(null);
      }
    }, 200);
  }

  onTextKeyDown(event: any, q: Question) {
    if (event.key === 'Enter') {
      if (!event.shiftKey) {
        event.preventDefault();
        this.saveInlineText(q);
      }
    }
  }

  onChoiceKeyDown(event: any, ans: any, q: Question) {
    if (event.key === 'Enter') {
      if (!event.shiftKey) {
        event.preventDefault();
        this.saveChoiceText(ans, q);
      }
    }
  }

  async toggleChoiceCorrect(ans: any, q: Question) {
    const isCurrentlyCorrect = ans.fraction > 0;
    const newFraction = isCurrentlyCorrect ? 0.0 : 1.0;
    
    try {
      const { error } = await this.supabaseService.db
        .from('answers')
        .update({ fraction: newFraction })
        .eq('id', ans.id);

      if (error) throw error;

      // Update in memory state
      const updatedQuestions = this.allQuestions().map(item => {
        if (item.id === q.id && item.answers) {
          const updatedAnswers = item.answers.map((a: any) => {
            if (a.id === ans.id) {
              return { ...a, fraction: newFraction };
            }
            return a;
          });
          return { ...item, answers: updatedAnswers };
        }
        return item;
      });
      this.allQuestions.set(updatedQuestions);
      this.showToast(isCurrentlyCorrect ? 'Marked option as Incorrect' : 'Marked option as Correct', 'success');
    } catch (e: any) {
      this.showToast(e.message, 'error');
    }
  }

  ngOnInit() {
  }

  onSearchChange(value: string) {
    this.filterSearch.set(value);
    this.searchSubject.next(value);
  }

  onTeacherFilterChange(value: string) {
    this.filterTeacher.set(value);
    this.currentPage.set(1);
  }

  async loadAllQuestionsData() {
    this.loading.set(true);
    try {
      const { data, error } = await this.supabaseService.db
        .from('questions')
        .select('*, answers(*)')
        .is('deleted_at', null);

      if (error) throw error;
      
      const questions = (data as Question[]).filter(q => q.name !== '__SYSTEM_USER_RECORDS__');
      this.allQuestions.set(questions);

      // Also sync type counts
      this.loadQuestionTypeCounts();

      // Restore focus & scroll to the active question card
      const lastId = sessionStorage.getItem('last_edited_question_id');
      if (lastId) {
        const q = questions.find(item => item.id === lastId || item.parent_id === lastId);
        if (q) {
          const tab = q.status === 'pending_review' ? 'pending' : 
                      q.status === 'approved' ? 'approved' :
                      q.status === 'rejected' ? 'rejected' : 'draft';
          
          this.activeTab.set(tab);

          setTimeout(() => {
            const list = this.filteredQuestions();
            const matchingIndex = list.findIndex(item => item.id === q.id || item.parent_id === q.id);
            
            if (matchingIndex !== -1) {
              const targetPage = Math.floor(matchingIndex / this.pageSize()) + 1;
              this.currentPage.set(targetPage);
              this.scrollToQuestion(q.id);
            }
          }, 100);
        }
      }
    } catch (e) {
      console.error('Error loading all questions:', e);
    } finally {
      this.loading.set(false);
    }
  }



  async loadQuestionsForActiveTab() {
    await this.loadAllQuestionsData();
  }

  // Computed signals for the active list based on allQuestions and activeTab
  filteredQuestions = computed(() => {
    const allQs = this.allQuestions();
    const status = this.activeTab() === 'pending' ? 'pending_review' : 
                   this.activeTab() === 'approved' ? 'approved' :
                   this.activeTab() === 'rejected' ? 'rejected' : 'draft';
    
    // 1. Filter for latest versions in family
    const familyMap = new Map<string, Question>();
    allQs.forEach(q => {
      const familyId = q.parent_id || q.id;
      const existing = familyMap.get(familyId);
      if (!existing || q.version > existing.version) {
        familyMap.set(familyId, q);
      }
    });
    
    // 2. Filter by status, qtype, category, teacher
    let result = Array.from(familyMap.values()).filter(q => q.status === status);
    
    if (this.filterQtype()) result = result.filter(q => q.qtype === this.filterQtype());
    if (this.filterCategory()) result = result.filter(q => q.category_id === this.filterCategory());
    if (this.filterTeacher()) {
      const teacher = this.filterTeacher().toLowerCase();
      result = result.filter(q => q.metadata?.author_name?.toLowerCase().includes(teacher));
    }
    
    // 3. Sort before sequence number mapping (Pending is oldest-first, others are newest-first)
    const isPending = this.activeTab() === 'pending';
    result.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return isPending ? dateA - dateB : dateB - dateA;
    });

    // 4. Map sequence numbers
    result = result.map((q, idx) => ({
      ...q,
      sequenceNumber: idx + 1
    }));

    // 5. Apply search filter (supporting sequence number "#45" or just "45")
    const search = this.debouncedSearch().toLowerCase().trim();
    if (search) {
      result = result.filter(q => {
        const nameMatch = q.name.toLowerCase().includes(search);
        const textMatch = q.question_text.toLowerCase().includes(search);
        const parsedSeq = parseInt(search.replace(/no\.|no|#| /g, ''), 10);
        const seqMatch = !isNaN(parsedSeq) && q.sequenceNumber === parsedSeq;
        return nameMatch || textMatch || seqMatch;
      });
    }

    const selectedTags = this.filterSelectedTags();
    if (selectedTags && selectedTags.length > 0) {
      result = result.filter(q => {
        const qTags = (q.metadata?.tags || []).map((t: string) => t.toLowerCase());
        return selectedTags.every(tag => qTags.includes(tag.toLowerCase()));
      });
    }

    return result;
  });

  paginatedQuestions = computed(() => {
    const questions = this.filteredQuestions();
    const countToLoad = this.currentPage() * this.pageSize();
    return questions.slice(0, countToLoad);
  });

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

  filteredQuestionTypeCounts = computed(() => {
    const list = this.filteredQuestions();
    const countsMap: Record<string, number> = {};
    list.forEach(q => {
      countsMap[q.qtype] = (countsMap[q.qtype] || 0) + 1;
    });
    
    return Object.keys(countsMap).map(type => ({
      type,
      count: countsMap[type],
      label: this.typeLabels[type]?.label || type,
      icon: this.typeLabels[type]?.icon || '❓'
    })).sort((a, b) => b.count - a.count);
  });

  filterSelectedTags = signal<string[]>(
    JSON.parse(sessionStorage.getItem('admin_filter_selected_tags') || '[]')
  );
  filteredTagsSuggestions = signal<string[]>([]);

  searchTagFilters(event: any) {
    const query = event.query.toLowerCase().trim();
    const allTags = this.tagsList().map(t => t.name.toLowerCase());
    this.filteredTagsSuggestions.set(
      allTags.filter(tag => tag.includes(query))
    );
  }

  clearFilters() {
    this.filterTeacher.set('');
    this.filterQtype.set('');
    this.filterCategory.set('');
    this.filterSearch.set('');
    this.filterSelectedTags.set([]);
    this.searchSubject.next('');
    this.currentPage.set(1);
  }

  hasActiveFilters = computed(() => {
    return !!(
      this.filterTeacher() || 
      this.filterQtype() || 
      this.filterCategory() || 
      this.filterSearch() || 
      this.filterSelectedTags().length > 0
    );
  });

  async loadTagsData() {
    this.loadingTags.set(true);
    try {
      const { data: tagsData, error: tagsErr } = await this.supabaseService.db
        .from('tags')
        .select('id, name');
      
      if (tagsErr) throw tagsErr;

      const { data: linkData, error: linkErr } = await this.supabaseService.db
        .from('question_tags')
        .select('tag_id');

      if (linkErr) throw linkErr;

      const countMap = new Map<string, number>();
      (linkData || []).forEach((item: any) => {
        if (item.tag_id) {
          countMap.set(item.tag_id, (countMap.get(item.tag_id) || 0) + 1);
        }
      });

      const enrichedTags = (tagsData || []).map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        count: countMap.get(tag.id) || 0
      })).sort((a: any, b: any) => b.count - a.count || a.name.localeCompare(b.name));

      this.tagsList.set(enrichedTags);
    } catch (e) {
      console.error('Error loading tags data:', e);
    } finally {
      this.loadingTags.set(false);
    }
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
    // 1. Get all roles to identify teachers vs admins
    const { data: roles } = await this.supabaseService.db
      .from('user_roles')
      .select('user_id, role');

    // 2. Get all profiles
    const { data: profiles } = await this.supabaseService.db
      .from('profiles')
      .select('id, full_name, email');

    // 3. Get all unique authors from questions
    const { data: qMeta } = await this.supabaseService.db
      .from('questions')
      .select('id, created_by, status, metadata')
      .is('deleted_at', null);

    const profileMap = new Map<string, {id: string, name: string, email?: string, isExplicitTeacher: boolean}>();

    // Fill from profiles first
    profiles?.forEach(p => {
      let role = roles?.find(r => r.user_id === p.id)?.role;
      if (!role) {
        if (p.email === 'teacher@mail.com' || p.email === 'user1@mail.com') {
          role = 'teacher';
        } else if (p.email === 'admin@mail.com') {
          role = 'admin';
        } else if (p.email === 'teacher2@mail.com') {
          role = 'assistant_teacher';
        }
      }
      profileMap.set(p.id, { 
        id: p.id,
        name: p.full_name, 
        email: p.email,
        isExplicitTeacher: role === 'teacher'
      });
    });

    // Augment with roles (even if no profile yet)
    roles?.forEach(r => {
      if (!profileMap.has(r.user_id)) {
        profileMap.set(r.user_id, {
          id: r.user_id,
          name: `User (${r.user_id.substring(0, 5)})`,
          isExplicitTeacher: r.role === 'teacher'
        });
      }
    });

    // Augment with question metadata (authors who might not have profiles/roles)
    qMeta?.forEach(q => {
      const meta = (q.metadata as any) || {};
      // Use author_id from metadata (true author), fallback to created_by
      const uid = meta.author_id || q.created_by;
      const existing = profileMap.get(uid);
      // Only use author_name — never use modified_by (that's whoever last edited, not the author)
      const metaName = meta.author_name;
      const metaEmail = meta.author_email;

      if (metaName || metaEmail) {
        if (!existing) {
          profileMap.set(uid, { 
            id: uid,
            name: metaName || `Teacher (${uid.substring(0, 5)})`, 
            email: metaEmail,
            isExplicitTeacher: false 
          });
        } else {
          // Only override if the existing name is generic (auto-generated placeholder)
          const isGeneric = !existing.name || existing.name.startsWith('User (') || existing.name.startsWith('Teacher (');
          if (isGeneric || !existing.email) {
            profileMap.set(uid, {
              ...existing,
              name: (isGeneric && metaName) ? metaName : existing.name,
              email: existing.email || metaEmail
            });
          }
        }
      }
    });

    // Filter to show:
    // 1. Anyone with role='teacher'
    // 2. Anyone who has authored a question
    // 3. Anyone with a profile (they are registered users)
    const teachers: Teacher[] = Array.from(profileMap.values())
      .map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: roles?.find(r => r.user_id === u.id)?.role || 'teacher'
      }));

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
      this.loadAllQuestionsData();
    }
  }

  async updateStatus(id: string, status: 'approved' | 'rejected') {
    // Fetch the question to get details and current status
    const { data: question } = await this.supabaseService.db
      .from('questions')
      .select('name, status, created_by, metadata')
      .eq('id', id)
      .single();

    let extraMetadata: any = null;
    if (question && status === 'rejected') {
      const reason = prompt('Reason for rejection:');
      if (reason === null) return;

      const trimmedReason = reason.trim() || 'Rejected by reviewer.';
      const newComment = {
        user: this.supabaseService.currentUserName,
        text: trimmedReason,
        date: new Date().toISOString()
      };

      const currentComments = (question.metadata as any)?.comments || [];
      extraMetadata = {
        ...(question.metadata || {}),
        rejection_reason: trimmedReason,
        rejected_by: this.supabaseService.currentUserName,
        rejected_at: new Date().toISOString(),
        comments: [...currentComments, newComment]
      };
    }

    const updateData: any = { status };
    if (extraMetadata) {
      updateData.metadata = extraMetadata;
    }

    const { error } = await this.supabaseService.db
      .from('questions')
      .update(updateData)
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

      // Automatically clear (mark read) task notifications for all assigned reviewers
      this.notificationService.markReviewNotificationsAsRead(id);

      // Retract active review notifications
      if (status === 'rejected') {
        await this.notificationService.retractReviewNotifications(id);
      }

      // Notify the question author about the status change
      if (question) {
        const authorId = question.metadata?.author_id || question.created_by;
        const adminName = this.supabaseService.currentUserName;
        
        this.notificationService.createNotification(
          authorId,
          status === 'approved' ? 'question_approved' : 'question_rejected',
          `Question ${status === 'approved' ? 'Approved' : 'Rejected'}`,
          `${adminName} has ${status} your question "${question.name}".`,
          { question_id: id, status, reviewed_by: adminName }
        );
      }

      this.loadQuestionsForActiveTab();
      this.loadAllQuestionsData();
      this.loadQuestionTypeCounts();
    }
  }

  assigningQuestionId = signal<string | null>(null);
  selectedReviewers = signal<Teacher[]>([]);
  filteredTeachers = signal<Teacher[]>([]);

  startAssigning(q: Question) {
    this.assigningQuestionId.set(q.id);
    this.selectedReviewers.set(this.getAssignedTeachers(q.id));
  }

  searchTeachers(event: any, contextQuestion?: Question) {
    const query = event.query.toLowerCase();
    this.filteredTeachers.set(
      this.availableTeachers().filter(t => {
        const matches = t.name.toLowerCase().includes(query);
        const isAuthor = contextQuestion ? contextQuestion.created_by === t.id : false;
        return matches && !isAuthor;
      })
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

    // VALIDATION 1: Cannot assign to self (author)
    if (question.created_by === teacher.id) {
      this.messageService.add({ 
        severity: 'warn', 
        summary: 'Invalid Assignment', 
        detail: 'A teacher cannot review their own question.' 
      });
      // Force refresh to remove the invalid chip from UI
      this.loadAssignments();
      return;
    }

    // VALIDATION 2: Check for existing assignment
    const isAlreadyAssigned = this.allAssignments().some(
      a => a.question_id === question.id && a.assigned_to_id === teacher.id
    );

    if (isAlreadyAssigned) {
      this.messageService.add({ 
        severity: 'info', 
        summary: 'Already Assigned', 
        detail: `${teacher.name} is already assigned to this question.` 
      });
      return;
    }

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

      // Notify the teacher about the new assignment
      this.notificationService.createNotification(
        teacher.id,
        'review_assigned',
        'New Review Task Assigned',
        `Admin ${adminName} has assigned you to review the question "${question.name}".`,
        { 
          question_id: question.id, 
          assigned_by: adminName,
          email_trigger: true // This can be used by Supabase Edge Functions to send an email
        }
      );

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
      await this.loadAssignments();
      this.selectedReviewers.set(this.getAssignedTeachers(question.id));
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
      await this.loadAssignments();
      this.selectedReviewers.set(this.getAssignedTeachers(question.id));
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
      .select('id, qtype, version, parent_id, name')
      .is('deleted_at', null);

    if (error || !data) return;

    // Filter out system records
    const cleanData = (data as any[]).filter(q => q.name !== '__SYSTEM_USER_RECORDS__');

    // Filter to only include the LATEST version of each question family
    const familyMap = new Map<string, any>();
    cleanData.forEach((q: any) => {
      const familyId = q.parent_id || q.id;
      const existing = familyMap.get(familyId);
      if (!existing || q.version > existing.version) {
        familyMap.set(familyId, q);
      }
    });

    const latestQuestions = Array.from(familyMap.values());
    this.totalQuestions.set(latestQuestions.length);

    const countMap = new Map<string, number>();
    latestQuestions.forEach((q: any) => {
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
      this.loadAllQuestionsData();
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
    const total = this.totalPages();
    if (page >= 1 && (total === 0 || page <= total)) {
      if (this.currentPage() !== page) {
        this.currentPage.set(page);
      }
    }
  }

  totalPages = computed(() => {
    const count = this.filteredQuestions().length;
    return Math.ceil(count / this.pageSize());
  });

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

  startEditCategory(cat: Category) {
    this.editingCategoryId.set(cat.id);
    this.newCategoryName = cat.name;
    this.newCategoryDescription = cat.description || '';
    this.newCategoryParent = cat.parent_id;
    this.newCategoryIsGlobal = cat.is_global;
  }

  cancelEditCategory() {
    this.editingCategoryId.set(null);
    this.newCategoryName = '';
    this.newCategoryDescription = '';
    this.newCategoryParent = null;
    this.newCategoryIsGlobal = false;
  }

  async updateCategory() {
    const id = this.editingCategoryId();
    if (!id || !this.newCategoryName.trim()) return;
    
    if (this.newCategoryParent === id) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'A category cannot be its own parent.' });
      return;
    }

    const { error } = await this.supabaseService.db
      .from('question_categories')
      .update({
        name: this.newCategoryName,
        description: this.newCategoryDescription,
        parent_id: this.newCategoryParent,
        is_global: this.newCategoryIsGlobal
      })
      .eq('id', id);

    if (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: error.message });
    } else {
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Category updated' });
      this.cancelEditCategory();
      this.loadCategories();
    }
  }

  flatCategories = computed(() => {
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
  });

  async exportReadyQuestions() {
    this.loading.set(true);
    try {
      // 1. Fetch all approved questions
      const { data: questions, error: qError } = await this.supabaseService.db
        .from('questions')
        .select('*')
        .eq('status', 'approved')
        .is('deleted_at', null);

      if (qError) throw qError;

      // Filter out system registry records
      const validQuestions = (questions as Question[] || []).filter(q => q.name !== '__SYSTEM_USER_RECORDS__');

      if (validQuestions.length === 0) {
        this.messageService.add({ severity: 'info', summary: 'No Questions', detail: 'There are no questions with status "Ready" to export.' });
        return;
      }

      // 2. Filter questions to match the active filters on the UI (latest versions first)
      let filtered = validQuestions;
      
      const familyMap = new Map<string, Question>();
      filtered.forEach(q => {
        const familyId = q.parent_id || q.id;
        const existing = familyMap.get(familyId);
        if (!existing || q.version > existing.version) {
          familyMap.set(familyId, q);
        }
      });
      filtered = Array.from(familyMap.values());

      if (this.filterCategory()) {
        filtered = filtered.filter(q => q.category_id === this.filterCategory());
      }
      
      if (this.filterQtype()) {
        filtered = filtered.filter(q => q.qtype === this.filterQtype());
      }
      
      if (this.filterTeacher()) {
        const teacher = this.filterTeacher().toLowerCase();
        filtered = filtered.filter(q => q.metadata?.author_name?.toLowerCase().includes(teacher));
      }
      
      const search = this.debouncedSearch()?.toLowerCase();
      if (search) {
        filtered = filtered.filter(q => 
          q.name?.toLowerCase().includes(search) || 
          q.question_text?.toLowerCase().includes(search)
        );
      }

      if (filtered.length === 0) {
        this.messageService.add({ severity: 'info', summary: 'No Matching Questions', detail: 'There are no ready questions matching your active filters to export.' });
        return;
      }

      // 3. Fetch answers for only these filtered questions
      const qIds = filtered.map(q => q.id);
      const { data: answers, error: aError } = await this.supabaseService.db
        .from('answers')
        .select('*')
        .in('question_id', qIds);

      if (aError) throw aError;

      const answersMap = new Map<string, any[]>();
      answers?.forEach(a => {
        if (!answersMap.has(a.question_id)) answersMap.set(a.question_id, []);
        answersMap.get(a.question_id)!.push(a);
      });

      // 4. Fetch categories for path building
      const { data: categories } = await this.supabaseService.db
        .from('question_categories')
        .select('*');

      // 5. Generate and download XML
      const xml = this.importExportService.exportMoodleXML(filtered, answersMap, categories || []);
      const timestamp = new Date().toISOString().split('T')[0];
      
      let fileName = `moodle-questions-ready-${timestamp}.xml`;
      if (this.filterCategory()) {
        const catName = this.getCategoryName(this.filterCategory())
          .toLowerCase()
          .replace(/[^a-z0-9_-]/gi, '_');
        if (catName) {
          fileName = `moodle-questions-ready-${catName}-${timestamp}.xml`;
        }
      }

      this.importExportService.downloadFile(xml, fileName, 'application/xml');
      
      this.messageService.add({ severity: 'success', summary: 'Export Success', detail: `Exported ${filtered.length} questions.` });
    } catch (err: any) {
      this.messageService.add({ severity: 'error', summary: 'Export Failed', detail: err.message });
    } finally {
      this.loading.set(false);
    }
  }

  // ====================================================
  // USER MANAGEMENT METHODS & SIGNALS
  // ====================================================
  
  // Load root categories (subjects)
  rootCategories = computed(() => {
    return this.categories().filter(c => c.parent_id === null);
  });



  showToast(detail: string, severity: 'success' | 'error' | 'info' = 'success', summary = 'Notification') {
    this.messageService.add({ severity, summary, detail });
  }

  // ====================================================
  // IMPORT METHODS
  // ====================================================
  fileInputElement: HTMLInputElement | null = null;

  resetImport() {
    this.importPreview.set([]);
    this.importText = '';
    this.importError.set(null);
    this.importFileBuffer = null;
    this.importLogs.set([]);
    this.importedGIFTText.set('');
    if (this.fileInputElement) {
      this.fileInputElement.value = '';
    }
  }

  async onImportFileSelected(event: any, element: HTMLInputElement) {
    this.fileInputElement = element;
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
          const docxText = await this.importExportService.extractDocxText(this.importFileBuffer!);
          const giftText = this.importExportService.convertRawTextToGIFT(docxText);
          this.importedGIFTText.set(giftText);
          
          const questions = this.importExportService.parseGIFT(giftText);
          this.importPreview.set(questions);
          if (questions.length === 0) {
            this.importError.set('No questions matching the system structure were found. Please verify your Word file format.');
            this.showToast('No valid questions detected in Word file. Check formatting.', 'error');
          } else {
            this.importError.set(null);
          }
        } catch (err) {
          this.importError.set('Failed to parse Word file');
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
        this.importedGIFTText.set(this.importText); // Populate for raw GIFT download if GIFT uploaded
        this.parseImportPreview();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  downloadConvertedGIFT() {
    const text = this.importedGIFTText();
    if (text) {
      this.importExportService.downloadFile(text, 'converted_questions.gift', 'text/plain;charset=utf-8');
      this.showToast('Downloaded GIFT file successfully.', 'success');
    }
  }

  copyConvertedGIFT() {
    const text = this.importedGIFTText();
    if (text) {
      navigator.clipboard.writeText(text);
      this.showToast('GIFT format copied to clipboard!', 'success');
    }
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
      if (questions.length === 0) {
        this.importError.set('No questions matching the system structure were found. Please check your file content format.');
        this.showToast('No valid questions detected. Check formatting.', 'error');
      } else {
        this.importError.set(null);
      }
    } catch (err: any) {
      this.importError.set(err.message || 'Failed to parse import data');
      this.showToast(err.message || 'Failed to parse import data', 'error');
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
      targetCategoryId = this.filterCategory();
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

    const CHUNK_SIZE = 25;
    for (let i = 0; i < questions.length; i += CHUNK_SIZE) {
      const chunk = questions.slice(i, i + CHUNK_SIZE);
      const questionsPayload = chunk.map(q => ({
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
      }));

      try {
        const { data: insertedQuestions, error: qErr } = await this.supabaseService.db
          .from('questions')
          .insert(questionsPayload)
          .select('id, name');

        if (qErr) {
          console.error('Batch questions insert error:', qErr);
          continue;
        }

        if (insertedQuestions && insertedQuestions.length > 0) {
          const allAnswersToInsert: any[] = [];
          const tagSyncPromises: Promise<any>[] = [];

          insertedQuestions.forEach((newQ, idx) => {
            const origQ = chunk[idx];
            if (origQ && origQ.answers && origQ.answers.length > 0) {
              origQ.answers.forEach(a => {
                allAnswersToInsert.push({
                  question_id: newQ.id,
                  answer_text: a.answer_text,
                  fraction: a.fraction,
                  feedback: a.feedback
                });
              });
            }

            const importTags = origQ?.metadata?.['tags'] || [];
            if (importTags.length > 0) {
              tagSyncPromises.push(this.supabaseService.syncQuestionTags(newQ.id, importTags));
            }
          });

          if (allAnswersToInsert.length > 0) {
            await this.supabaseService.db.from('answers').insert(allAnswersToInsert);
          }
          if (tagSyncPromises.length > 0) {
            await Promise.allSettled(tagSyncPromises);
          }

          successCount += insertedQuestions.length;
        }
      } catch (err: any) {
        console.error('Batch import chunk error:', err);
      }
    }

    this.showToast(`Imported ${successCount} questions as Draft`, 'success');
    this.importLoading.set(false);
    this.showImportModal.set(false);
    this.resetImport();
    
    // Refresh admin data
    this.loadQuestionsForActiveTab();
    this.loadAllQuestionsData();
  }

}
