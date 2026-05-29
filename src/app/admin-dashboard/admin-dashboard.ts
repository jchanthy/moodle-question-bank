import { Component, inject, signal, computed, OnInit, effect, untracked, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule, NgIf, NgFor, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { ImportExportService } from '../services/import-export.service';
import { Router, RouterModule } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ToastModule } from 'primeng/toast';
import { PaginatorModule } from 'primeng/paginator';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
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
    MatIcon
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
  activeTab = signal<'pending' | 'approved' | 'rejected' | 'draft'>('pending');
  showTypeHelp = signal(false);

  // View state
  currentView = signal<'questions' | 'team' | 'report' | 'categories' | 'users' | 'tags'>('questions');
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

  // User Management State
  allProfiles = signal<any[]>([]);
  allUserRoles = signal<any[]>([]);
  pendingUsersCount = computed(() => {
    return this.allUserRoles().filter(r => r.role?.startsWith('pending_')).length;
  });
  loadingUsers = signal(false);
  showAddUserModal = signal(false);
  showEditUserModal = signal(false);

  // User Forms State
  userForm = {
    email: '',
    password: '',
    fullName: '',
    role: 'teacher' as 'admin' | 'teacher' | 'assistant_teacher',
    specialization: [] as string[]
  };

  editingUser = signal<any | null>(null);
  userSearchKeyword = signal('');
  debouncedUserSearch = signal('');

  // Computed signal for Drawer visibility
  isDrawerVisible = computed(() => !!this.selectedTeacherId());
  closeDrawer() {
    this.selectedTeacherId.set(null);
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
    }).sort((a, b) => {
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
    }
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
        } else if (view === 'users') {
          this.loadUsersData();
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
  }

  ngOnInit() {
    // Initial load of users in the background to ensure the pending count badge is visible immediately
    this.loadUsersData();
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
        .select('*')
        .is('deleted_at', null);

      if (error) throw error;
      
      const questions = (data as Question[]).filter(q => q.name !== '__SYSTEM_USER_RECORDS__');
      this.allQuestions.set(questions);

      // Also sync total counts and type counts
      this.syncTotalCounts(questions);
      this.loadQuestionTypeCounts();
    } catch (e) {
      console.error('Error loading all questions:', e);
    } finally {
      this.loading.set(false);
    }
  }

  private syncTotalCounts(questions: Question[]) {
    // Filter for latest versions
    const familyMap = new Map<string, Question>();
    questions.forEach(q => {
      const familyId = q.parent_id || q.id;
      const existing = familyMap.get(familyId);
      if (!existing || q.version > existing.version) {
        familyMap.set(familyId, q);
      }
    });
    const latestQuestions = Array.from(familyMap.values());

    const counts = {
      pending: latestQuestions.filter(q => q.status === 'pending_review').length,
      approved: latestQuestions.filter(q => q.status === 'approved').length,
      rejected: latestQuestions.filter(q => q.status === 'rejected').length,
      draft: latestQuestions.filter(q => q.status === 'draft').length
    };
    this.totalCounts.set(counts);
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
    
    // 2. Filter by status, qtype, category, teacher, search
    let result = Array.from(familyMap.values()).filter(q => q.status === status);
    
    if (this.filterQtype()) result = result.filter(q => q.qtype === this.filterQtype());
    if (this.filterCategory()) result = result.filter(q => q.category_id === this.filterCategory());
    if (this.filterTeacher()) {
      const teacher = this.filterTeacher().toLowerCase();
      result = result.filter(q => q.metadata?.author_name?.toLowerCase().includes(teacher));
    }
    
    const search = this.debouncedSearch().toLowerCase();
    if (search) {
      result = result.filter(q => 
        q.name.toLowerCase().includes(search) || 
        q.question_text.toLowerCase().includes(search)
      );
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
    const from = (this.currentPage() - 1) * this.pageSize();
    const to = from + this.pageSize();
    
    const isPending = this.activeTab() === 'pending';
    return [...questions].sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return isPending ? dateA - dateB : dateB - dateA;
    }).slice(from, to);
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

  filterSelectedTags = signal<string[]>([]);
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
  filteredTeachers = signal<Teacher[]>([]);

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
    const status = this.activeTab();
    const count = status === 'pending' ? this.totalCounts().pending :
                 status === 'approved' ? this.totalCounts().approved :
                 status === 'rejected' ? this.totalCounts().rejected :
                 this.totalCounts().draft;
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
      if (!questions || questions.length === 0) {
        this.messageService.add({ severity: 'info', summary: 'No Questions', detail: 'There are no questions with status "Ready" to export.' });
        return;
      }

      // 2. Filter questions to match the active filters on the UI (latest versions first)
      let filtered = questions as Question[];
      
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

  // Filtered profiles for User Management
  filteredProfiles = computed(() => {
    const profiles = this.allProfiles();
    const roles = this.allUserRoles();
    const search = this.userSearchKeyword().toLowerCase();

    return profiles.filter(p => {
      const emailMatch = p.email?.toLowerCase().includes(search);
      const nameMatch = p.full_name?.toLowerCase().includes(search);
      if (search && !emailMatch && !nameMatch) return false;
      return true;
    }).map(p => {
      const r = roles.find(role => role.user_id === p.id);
      let userRole = r?.role || '';
      
      // Fallback defaults
      if (!userRole) {
        if (p.email === 'admin@mail.com') userRole = 'admin';
        else if (p.email === 'teacher2@mail.com') userRole = 'assistant_teacher';
        else userRole = 'teacher';
      }

      // Read status directly from profiles table bio column (Best Practice)
      const isPending = p.bio === 'pending' || userRole.startsWith('pending_');
      const baseRole = isPending ? (userRole.startsWith('pending_') ? userRole.substring(8) : userRole) : userRole;
      const isSuspended = p.bio === 'suspended' || userRole === 'suspended';

      return {
        ...p,
        role: baseRole,
        isPending: isPending,
        isSuspended: isSuspended,
        rawRole: userRole
      };
    });
  });

  // Helper to resolve root category names for specialization
  getSpecializationNames(specIds: string[]): string {
    if (!specIds || specIds.length === 0) return 'None (All Subjects)';
    const cats = this.categories();
    return specIds
      .map(id => cats.find(c => c.id === id)?.name || id)
      .join(', ');
  }

  showToast(detail: string, severity: 'success' | 'error' | 'info' = 'success', summary = 'Notification') {
    this.messageService.add({ severity, summary, detail });
  }

  async loadUsersData() {
    this.loadingUsers.set(true);
    try {
      // 1. Load profiles from DB
      const { data: dbProfiles, error: pErr } = await this.supabaseService.db
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (pErr) throw pErr;

      // 2. Load user roles from DB
      const { data: dbRoles, error: rErr } = await this.supabaseService.db
        .from('user_roles')
        .select('*');

      if (rErr) throw rErr;

      // 3. Load master registry (Legacy fallback / source of migration)
      const registry = await this.supabaseService.getUserRegistry();

      // Self-healing check: Ensure any user in DB profiles table exists in the legacy registry
      let registryModified = false;
      for (const p of dbProfiles || []) {
        if (!registry[p.id]) {
          let baseRole = 'teacher';
          if (p.email === 'admin@mail.com') baseRole = 'admin';
          else if (p.email === 'teacher2@mail.com') baseRole = 'assistant_teacher';

          registry[p.id] = {
            id: p.id,
            email: p.email,
            full_name: p.full_name,
            role: baseRole,
            specialization: p.specialization || [],
            approval_status: p.bio === 'suspended' ? 'suspended' : (p.bio || 'approved')
          };
          registryModified = true;
        }
      }
      if (registryModified) {
        try {
          await this.supabaseService.saveUserRegistry(registry);
        } catch (syncErr) {
          console.warn('Silent save registry failed:', syncErr);
        }
      }

      const profiles = [...(dbProfiles || [])];
      const roles = (dbRoles || []).map(r => ({ user_id: r.user_id, role: r.role }));

      // Live Migration: Reconcile DB profiles with registry roles and specializations
      for (const userId of Object.keys(registry)) {
        const regUser = registry[userId];
        const dbProfile = profiles.find(p => p.id === userId);
        const dbRole = roles.find(r => r.user_id === userId);

        // If user doesn't exist in DB roles table, migrate them!
        if (!dbRole) {
          // Keep role in user_roles clean ('admin', 'teacher', 'assistant_teacher')
          // to adhere to the database check constraint user_roles_role_check.
          let cleanRole = regUser.role;
          if (cleanRole !== 'admin' && cleanRole !== 'teacher' && cleanRole !== 'assistant_teacher') {
            cleanRole = 'teacher';
          }
          await this.supabaseService.db
            .from('user_roles')
            .upsert({ user_id: userId, role: cleanRole }, { onConflict: 'user_id' });
          
          roles.push({ user_id: userId, role: cleanRole });
        }

        // If user doesn't exist in DB profiles table, migrate them!
        if (!dbProfile) {
          const virtualProfile = {
            id: userId,
            email: regUser.email,
            full_name: regUser.full_name,
            specialization: regUser.specialization || [],
            bio: regUser.approval_status === 'suspended' ? 'suspended' : regUser.approval_status,
            department: regUser.role,
            avatar_scale: 1,
            avatar_pos_x: 50,
            avatar_pos_y: 50,
            updated_at: new Date().toISOString()
          };

          await this.supabaseService.db
            .from('profiles')
            .upsert(virtualProfile, { onConflict: 'id' });

          profiles.push(virtualProfile);
        } else {
          // If profile exists but needs updates from legacy registry
          const needsSync = !dbProfile.specialization || dbProfile.specialization.length === 0;
          if (needsSync && regUser.specialization?.length > 0) {
            dbProfile.specialization = regUser.specialization;
            await this.supabaseService.db
              .from('profiles')
              .update({ specialization: regUser.specialization })
              .eq('id', userId);
          }
          
          // Always align the in-memory profile status and department with the registry
          const registryStatus = regUser.approval_status === 'suspended' ? 'suspended' : regUser.approval_status;
          const oldBio = dbProfile.bio;
          const oldDept = dbProfile.department;
          
          dbProfile.bio = registryStatus;
          dbProfile.department = regUser.role;
          
          // Sync to the database profiles table if out of sync
          if (oldBio !== registryStatus || oldDept !== regUser.role) {
            await this.supabaseService.db
              .from('profiles')
              .update({ bio: registryStatus, department: regUser.role })
              .eq('id', userId);
          }
        }
      }

      this.allProfiles.set(profiles);
      this.allUserRoles.set(roles);
    } catch (err: any) {
      this.showToast('Failed to load users: ' + err.message, 'error');
    } finally {
      this.loadingUsers.set(false);
    }
  }

  openAddUser() {
    this.userForm = {
      email: '',
      password: '',
      fullName: '',
      role: 'teacher',
      specialization: []
    };
    this.showAddUserModal.set(true);
  }

  toggleSpecialization(catId: string) {
    const current = [...this.userForm.specialization];
    const idx = current.indexOf(catId);
    if (idx > -1) {
      current.splice(idx, 1);
    } else {
      current.push(catId);
    }
    this.userForm.specialization = current;
  }

  async createUser() {
    const f = this.userForm;
    if (!f.email || !f.fullName || !f.password) {
      this.showToast('Please fill in all required fields.', 'error');
      return;
    }

    if (f.password.length < 6) {
      this.showToast('Temporary password must be at least 6 characters.', 'error');
      return;
    }

    this.loading.set(true);
    try {
      // 1. Instantiate secondary Supabase client with persistSession: false
      const tempClient = createClient(environment.supabaseUrl, environment.supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });

      // 2. Sign up the new user
      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
        email: f.email,
        password: f.password,
        options: {
          data: {
            full_name: f.fullName
          }
        }
      });

      if (signUpError) throw signUpError;
      if (!signUpData.user) throw new Error('User creation returned empty payload.');

      const newUserId = signUpData.user.id;

      // 3. Database Table insert (user_roles & profiles)
      // Standard RLS policies require clean roles to pass DB constraints
      const { error: roleErr } = await this.supabaseService.db
        .from('user_roles')
        .upsert({ user_id: newUserId, role: f.role }, { onConflict: 'user_id' }); // Clean role!

      if (roleErr) throw roleErr;

      const { error: profileErr } = await this.supabaseService.db
        .from('profiles')
        .upsert({
          id: newUserId,
          email: f.email,
          full_name: f.fullName,
          specialization: f.specialization,
          bio: 'pending', // Pending status is stored here
          department: f.role,
          avatar_scale: 1,
          avatar_pos_x: 50,
          avatar_pos_y: 50,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (profileErr) throw profileErr;

      // 4. Sync backward to legacy registry to maintain consistency
      try {
        const registry = await this.supabaseService.getUserRegistry();
        registry[newUserId] = {
          id: newUserId,
          email: f.email,
          full_name: f.fullName,
          role: f.role,
          specialization: f.specialization,
          approval_status: 'pending'
        };
        await this.supabaseService.saveUserRegistry(registry);
      } catch (legacyErr) {
        console.warn('Legacy registry synchronization failed silently:', legacyErr);
      }

      this.showToast(`Pre-registered ${f.fullName}. Invitation email sent!`, 'success');
      this.showAddUserModal.set(false);
      
      // Reset form
      this.userForm = {
        email: '',
        password: '',
        fullName: '',
        role: 'teacher',
        specialization: []
      };

      await this.loadUsersData();
      await this.loadTeachers(); // Refresh team lists too
    } catch (err: any) {
      this.showToast('Failed to create user: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  editUser(profile: any) {
    this.editingUser.set(profile);
    this.userForm = {
      email: profile.email || '',
      password: '', // Password is not editable
      fullName: profile.full_name || '',
      role: profile.role || 'teacher',
      specialization: profile.specialization || []
    };
    this.showEditUserModal.set(true);
  }

  async updateUser() {
    const target = this.editingUser();
    if (!target) return;

    const f = this.userForm;
    if (!f.fullName) {
      this.showToast('Full name is required.', 'error');
      return;
    }

    this.loading.set(true);
    try {
      // 1. Relational database updates
      const { error: roleErr } = await this.supabaseService.db
        .from('user_roles')
        .upsert({ user_id: target.id, role: f.role }, { onConflict: 'user_id' }); // Clean role!
      if (roleErr) throw roleErr;

      const { error: profErr } = await this.supabaseService.db
        .from('profiles')
        .upsert({
          id: target.id,
          full_name: f.fullName,
          specialization: f.specialization,
          department: f.role,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      if (profErr) throw profErr;

      // 2. Legacy registry sync
      try {
        const registry = await this.supabaseService.getUserRegistry();
        if (registry[target.id]) {
          registry[target.id].full_name = f.fullName;
          registry[target.id].role = f.role;
          registry[target.id].specialization = f.specialization;
          await this.supabaseService.saveUserRegistry(registry);
        }
      } catch (legacyErr) {
        console.warn('Legacy registry synchronization failed silently:', legacyErr);
      }

      this.showToast(`User ${f.fullName} updated successfully`, 'success');
      this.showEditUserModal.set(false);
      this.editingUser.set(null);

      await this.loadUsersData();
      await this.loadTeachers(); // Refresh team list
    } catch (err: any) {
      this.showToast('Failed to update user: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async approveUser(profile: any) {
    this.loading.set(true);
    try {
      // 1. Relational database update (Approved status set purely in profiles.bio)
      const { error: profErr } = await this.supabaseService.db
        .from('profiles')
        .update({ bio: 'approved' })
        .eq('id', profile.id);
      if (profErr) throw profErr;

      // 2. Legacy registry sync
      try {
        const registry = await this.supabaseService.getUserRegistry();
        const entry = registry[profile.id] || {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          role: profile.role || 'teacher',
          specialization: profile.specialization || []
        };
        entry.approval_status = 'approved';
        registry[profile.id] = entry;
        await this.supabaseService.saveUserRegistry(registry);
      } catch (legacyErr) {
        console.warn('Legacy registry synchronization failed silently:', legacyErr);
      }

      this.showToast(`User ${profile.full_name || profile.email} approved successfully!`, 'success');
      await this.loadUsersData();
      await this.loadTeachers();
    } catch (err: any) {
      this.showToast('Failed to approve user: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async revokeUserAccess(profile: any) {
    if (!confirm(`Are you sure you want to revoke database dashboard access for "${profile.full_name || profile.email}"?`)) return;

    this.loading.set(true);
    try {
      // 1. Relational database update (Suspended status is set purely in profiles.bio to avoid role constraint violation)
      const { error: profErr } = await this.supabaseService.db
        .from('profiles')
        .update({ bio: 'suspended' })
        .eq('id', profile.id);
      if (profErr) throw profErr;

      // 2. Legacy registry sync
      try {
        const registry = await this.supabaseService.getUserRegistry();
        const entry = registry[profile.id] || {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          role: profile.role || 'teacher',
          specialization: profile.specialization || []
        };
        entry.approval_status = 'suspended';
        registry[profile.id] = entry;
        await this.supabaseService.saveUserRegistry(registry);
      } catch (legacyErr) {
        console.warn('Legacy registry synchronization failed silently:', legacyErr);
      }

      this.showToast(`Revoked access for ${profile.full_name || profile.email}`, 'success');
      await this.loadUsersData();
      await this.loadTeachers();
    } catch (err: any) {
      this.showToast('Failed to revoke access: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async reRegisterUser(profile: any) {
    this.loading.set(true);
    try {
      // 1. Relational database update (Approval status restored back to 'approved')
      const { error: profErr } = await this.supabaseService.db
        .from('profiles')
        .update({ bio: 'approved' })
        .eq('id', profile.id);
      if (profErr) throw profErr;

      // 2. Legacy registry sync
      try {
        const registry = await this.supabaseService.getUserRegistry();
        const entry = registry[profile.id] || {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          role: profile.role || 'teacher',
          specialization: profile.specialization || []
        };
        entry.approval_status = 'approved';
        registry[profile.id] = entry;
        await this.supabaseService.saveUserRegistry(registry);
      } catch (legacyErr) {
        console.warn('Legacy registry synchronization failed silently:', legacyErr);
      }

      this.showToast(`Restored active status for ${profile.full_name || profile.email}!`, 'success');
      await this.loadUsersData();
      await this.loadTeachers();
    } catch (err: any) {
      this.showToast('Failed to restore user: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async resendInviteMail(profile: any) {
    this.loading.set(true);
    try {
      const { error } = await this.supabaseService.auth.resetPasswordForEmail(profile.email, {
        redirectTo: window.location.origin + '/auth'
      });

      if (error) throw error;

      this.showToast(`Setup invitation email resent to ${profile.email}!`, 'success');
    } catch (err: any) {
      this.showToast('Failed to resend invite email: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }
}
