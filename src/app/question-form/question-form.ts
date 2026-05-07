import { Component, inject, signal, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, FormArray } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { ImportExportService } from '../services/import-export.service';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';

@Component({
  selector: 'app-question-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './question-form.html',
  styleUrl: './question-form.css'
})
export class QuestionFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private supabase = inject(SupabaseService);
  private importExport = inject(ImportExportService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loading = signal(false);
  uploading = signal(false);
  isDragging = signal(false);
  imagePreview = signal<string | null>(null);
  get isAdmin(): boolean {
    return this.supabase.currentUserRole() === 'admin';
  }
  
  get isAssignedReviewer(): boolean {
    const user = this.supabase.currentUser();
    const meta = this.questionMetadata();
    return meta?.assigned_to_id === user?.id;
  }

  get displayStatus(): string {
    const status = this.questionForm.get('status')?.value;
    if (status === 'approved') return 'Ready';
    return status ? status.replace(/_/g, ' ').charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ') : '';
  }

  showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    this.notification.set({ message, type });
    setTimeout(() => this.notification.set(null), 4000);
  }

  get currentTeacher(): string {
    return this.supabase.currentUserName;
  }

  editMode = signal(false);
  isLocked = signal(false);
  availableVersions = signal<any[]>([]); // To store all versions of this question family
  showImageUpload = signal(false);
  activeDraggingIndex = signal<number | null>(null);
  isPreviewMode = signal(false);
  studentPlacement = signal<Record<number, { x: number, y: number } | null>>({});
  questionId = signal<string | null>(null);
  versions = signal<any[]>([]);
  notification = signal<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  formCategories = signal<{ id: string; name: string; depth: number }[]>([]);
  showNewCategory = signal(false);
  newCategoryName = signal('');
  newCategoryParent = signal<string | null>(null);
  creatingCategory = signal(false);
  questionMetadata = signal<any>({});
  
  // Preview Testing State
  studentSelectedAnswer = signal<number | null>(null);
  studentTextAnswer = signal<string>('');
  previewResult = signal<{ isCorrect: boolean; feedback: string; grade: number } | null>(null);

  questionTypes = [
    { value: 'multichoice', label: 'Multiple Choice' },
    { value: 'truefalse', label: 'True/False' },
    { value: 'shortanswer', label: 'Short Answer' },
    { value: 'numerical', label: 'Numerical' },
    { value: 'essay', label: 'Essay' },
    { value: 'match', label: 'Matching' },
    { value: 'calculated', label: 'Calculated' },
    { value: 'calculatedmulti', label: 'Calculated Multichoice' },
    { value: 'calculatedsimple', label: 'Calculated Simple' },
    { value: 'ddwtos', label: 'Drag and Drop into Text' },
    { value: 'ddimageortext', label: 'Drag and Drop onto Image' },
    { value: 'ddmarker', label: 'Drag and Drop Matching' },
    { value: 'ordering', label: 'Ordering' },
    { value: 'coderunner', label: 'CodeRunner' },
    { value: 'multichoiceanswernone', label: 'All-or-Nothing Multiple Choice' }
  ];

  // Define the form
  questionForm = this.fb.group({
    name: ['', Validators.required],
    question_text: ['', Validators.required],
    qtype: ['multichoice', Validators.required],
    default_grade: [1.0, [Validators.required, Validators.min(0)]],
    penalty: [0.3333333, [Validators.required, Validators.min(0), Validators.max(1)]],
    general_feedback: [''],
    // Metadata
    shuffleanswers: [true],
    answernumbering: ['abc'],
    image_url: [''],
    version: [1],
    status: ['draft'],
    parent_id: [null],
    category_id: [null],
    // Answers array
    answers: this.fb.array([
      this.createAnswer(100),
      this.createAnswer(0)
    ])
  });

  constructor() { }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editMode.set(true);
      this.questionId.set(id);
      this.loadQuestionData(id);
    }
    this.loadFormCategories();

    this.questionForm.get('qtype')?.valueChanges.subscribe(type => {
      this.handleTypeChange(type);
    });
  }

  async loadQuestionData(id: string) {
    this.loading.set(true);
    try {
      const { data: question, error: qError } = await this.supabase.db
        .from('questions')
        .select('*')
        .eq('id', id)
        .single();

      if (qError) throw qError;

      // Fetch other versions in this family
      const parentId = question.parent_id || id;
      const { data: rawVersions } = await this.supabase.db
        .from('questions')
        .select('id, version, status, created_at')
        .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
        .order('version', { ascending: false });

      // Deduplicate by version number (keep the latest record for each version)
      const versionMap = new Map<number, any>();
      (rawVersions || []).forEach(v => {
        if (!versionMap.has(v.version)) {
          versionMap.set(v.version, v);
        }
      });
      const uniqueVersions = Array.from(versionMap.values());
      
      this.availableVersions.set(uniqueVersions);
      this.versions.set(uniqueVersions); 
      this.questionId.set(id);

      const { data: answers, error: aError } = await this.supabase.db
        .from('answers')
        .select('*')
        .eq('question_id', id);

      if (aError) throw aError;

      this.questionForm.patchValue({
        name: question.name,
        question_text: this.importExport.cleanHtml(question.question_text),
        qtype: question.qtype,
        general_feedback: this.importExport.cleanHtml(question.general_feedback),
        default_grade: question.default_grade,
        penalty: question.penalty,
        status: question.status,
        version: question.version || 1,
        parent_id: question.parent_id,
        category_id: question.category_id || null
      }, { emitEvent: false });

      // History is already handled and synced above

      // Handle metadata/image
      this.questionMetadata.set(question.metadata || {});
      if (question.metadata?.image_url) {
        this.imagePreview.set(question.metadata.image_url);
        this.questionForm.patchValue({ image_url: question.metadata.image_url });
      }

      // Populate answers
      const answersArray = this.answers;
      answersArray.clear();
      answers.forEach((ans: any) => {
        answersArray.push(this.fb.group({
          answer_text: [this.importExport.cleanHtml(ans.answer_text), Validators.required],
          fraction: [ans.fraction, Validators.required],
          feedback: [this.importExport.cleanHtml(ans.feedback || '')],
          x: [ans.x || 50],
          y: [ans.y || 50]
        }));
      });

    } catch (err: any) {
      console.error('Load error:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async loadFormCategories() {
    const { data, error } = await this.supabase.db
      .from('question_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error || !data) return;

    // Build flat hierarchy
    const map = new Map<string, any>();
    data.forEach(c => map.set(c.id, { ...c, children: [] }));
    const roots: any[] = [];
    data.forEach(c => {
      if (c.parent_id && map.has(c.parent_id)) {
        map.get(c.parent_id).children.push(map.get(c.id));
      } else {
        roots.push(map.get(c.id));
      }
    });

    const flatten = (cats: any[], depth = 0): { id: string; name: string; depth: number }[] => {
      let result: { id: string; name: string; depth: number }[] = [];
      cats.forEach(c => {
        result.push({ id: c.id, name: c.name, depth });
        if (c.children?.length) result = result.concat(flatten(c.children, depth + 1));
      });
      return result;
    };

    this.formCategories.set(flatten(roots));
  }

  async createCategory() {
    const name = this.newCategoryName().trim();
    if (!name) return;

    this.creatingCategory.set(true);
    try {
      // Get the max sort_order to place the new category at the end
      const { data: existing } = await this.supabase.db
        .from('question_categories')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextOrder = (existing?.[0]?.sort_order || 0) + 1;

      const { data: newCat, error } = await this.supabase.db
        .from('question_categories')
        .insert({
          name: name,
          parent_id: this.newCategoryParent() || null,
          sort_order: nextOrder
        })
        .select()
        .single();

      if (error) throw error;

      // Refresh category list
      await this.loadFormCategories();

      // Auto-select the newly created category
      this.questionForm.patchValue({ category_id: newCat.id });

      // Reset the inline form
      this.newCategoryName.set('');
      this.newCategoryParent.set(null);
      this.showNewCategory.set(false);

      this.showToast('Category "' + name + '" created!', 'success');
    } catch (err: any) {
      this.showToast('Error creating category: ' + err.message, 'error');
    } finally {
      this.creatingCategory.set(false);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      await this.processFile(files[0]);
    }
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) await this.processFile(file);
  }

  private async processFile(file: File) {
    this.uploading.set(true);
    try {
      // 1. Optimize Image
      const optimizedFile = await this.optimizeImage(file);
      
      // 2. Upload to Supabase Storage (using .db for the client)
      const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const { data, error } = await this.supabase.db.storage
        .from('question-images')
        .upload(fileName, optimizedFile);

      if (error) throw error;

      // 3. Get Public URL
      const { data: { publicUrl } } = this.supabase.db.storage
        .from('question-images')
        .getPublicUrl(fileName);

      this.questionForm.patchValue({ image_url: publicUrl });
      this.imagePreview.set(publicUrl);
    } catch (err: any) {
      console.error('Upload error:', err);
      alert('Failed to upload image: ' + err.message);
    } finally {
      this.uploading.set(false);
    }
  }

  private optimizeImage(file: File): Promise<Blob> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e: any) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          const MAX_WIDTH = 1200;
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            resolve(blob as Blob);
          }, 'image/jpeg', 0.7);
        };
      };
    });
  }

  handleTypeChange(type: string | null) {
    this.showImageUpload.set(false);
    while (this.answers.length) {
      this.answers.removeAt(0);
    }

    if (type === 'truefalse') {
      this.answers.push(this.fb.group({ answer_text: ['True', Validators.required], fraction: [100, Validators.required], feedback: [''] }));
      this.answers.push(this.fb.group({ answer_text: ['False', Validators.required], fraction: [0, Validators.required], feedback: [''] }));
    } else if (type === 'ddimageortext' || type === 'ordering' || type === 'match') {
      this.answers.push(this.createAnswer(100));
      this.answers.push(this.createAnswer(100));
      this.answers.push(this.createAnswer(100));
    } else if (type === 'essay' || type === 'coderunner') {
      // Empty
    } else {
      this.answers.push(this.createAnswer(100));
      this.answers.push(this.createAnswer(0));
    }
  }

  get answers() {
    return this.questionForm.get('answers') as FormArray;
  }

  get isReady() {
    return this.questionForm.get('status')?.value === 'approved';
  }

  get isNewVersion() {
    const v = this.questionForm.get('version')?.value;
    return v && Number(v) > 1;
  }

  createAnswer(fraction = 0) {
    return this.fb.group({
      answer_text: ['', Validators.required],
      fraction: [fraction, Validators.required],
      feedback: [''],
      x: [50], // Start in the center for easy finding
      y: [50]  // Start in the center for easy finding
    });
  }

  // Start dragging a marker
  startDragging(index: number, event: MouseEvent) {
    event.preventDefault();
    this.activeDraggingIndex.set(index);
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const index = this.activeDraggingIndex();
    if (index === null) return;

    const img = document.querySelector('img') as HTMLImageElement;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    const boundedX = Math.max(0, Math.min(100, x));
    const boundedY = Math.max(0, Math.min(100, y));

    const answer = this.answers.at(index);
    answer.patchValue({
      x: Math.round(boundedX * 100) / 100,
      y: Math.round(boundedY * 100) / 100
    });
  }

  @HostListener('window:mouseup')
  stopDragging() {
    this.activeDraggingIndex.set(null);
  }

  togglePreview() {
    this.isPreviewMode.set(!this.isPreviewMode());
    this.previewResult.set(null);
    this.studentSelectedAnswer.set(null);
    this.studentTextAnswer.set('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  checkPreviewAnswer() {
    const qtype = this.questionForm.get('qtype')?.value;
    const answers = this.answers.value;
    let isCorrect = false;
    let feedback = '';
    let grade = 0;

    if (['multichoice', 'truefalse', 'multichoiceanswernone'].includes(qtype!)) {
      const selectedIndex = this.studentSelectedAnswer();
      if (selectedIndex !== null) {
        const selected = answers[selectedIndex];
        grade = selected.fraction;
        isCorrect = grade === 100;
        feedback = selected.feedback || (isCorrect ? 'Well done!' : 'That is not correct.');
      }
    } else if (['shortanswer', 'numerical'].includes(qtype!)) {
      const response = this.studentTextAnswer().trim().toLowerCase();
      const match = answers.find((a: any) => a.answer_text.trim().toLowerCase() === response);
      if (match) {
        grade = match.fraction;
        isCorrect = grade === 100;
        feedback = match.feedback || (isCorrect ? 'Correct!' : 'Partial credit.');
      } else {
        isCorrect = false;
        feedback = 'Incorrect answer.';
      }
    }

    this.previewResult.set({ 
      isCorrect, 
      feedback: feedback + (this.questionForm.get('general_feedback')?.value ? '\n\n' + this.questionForm.get('general_feedback')?.value : ''),
      grade 
    });
  }

  removeImage() {
    if (confirm('Are you sure you want to remove the image? This will clear the draggable background.')) {
      this.imagePreview.set(null);
      this.questionForm.patchValue({ image_url: '' });
      this.showImageUpload.set(false);
    }
  }

  addAnswer() {
    this.answers.push(this.createAnswer(0));
  }

  removeAnswer(index: number) {
    if (this.answers.length > 2) {
      this.answers.removeAt(index);
    }
  }

  async onFormSubmit() {
    if (this.isReady) {
      // If ready, we branch into a new version (which defaults to pending_review)
      await this.saveQuestion('pending_review', false);
    } else {
      // If already a draft or pending, just update it to pending_review
      await this.submitForReview();
    }
  }

  async saveDraft() {
    await this.saveQuestion('draft', false);
  }

  async saveAndContinueEditing() {
    const currentStatus = this.questionForm.get('status')?.value;
    // Keep same status when continuing editing; default to 'draft' for new questions
    const status = (currentStatus === 'approved' || currentStatus === 'rejected') ? 'draft' : (currentStatus || 'draft');
    await this.saveQuestion(status as 'draft' | 'pending_review' | 'approved', true);
  }

  async submitForReview() {
    await this.saveQuestion('pending_review', false);
  }

  async markAsReady() {
    await this.saveQuestion('approved', false);
  }

  onVersionChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const newId = target.value;
    if (newId && newId !== this.questionId()) {
      this.router.navigate(['/teacher/edit-question', newId]).then(() => {
        this.loadQuestionData(newId);
      });
    }
  }

  private async saveQuestion(status: 'draft' | 'pending_review' | 'approved' | 'rejected', continueEditing: boolean = false, extraMetadata: any = {}): Promise<boolean> {
    if (this.questionForm.invalid) return false;
    this.loading.set(true);
    try {
      const user = this.supabase.currentUser();
      if (!user) throw new Error('User not authenticated');

      const formValue: any = this.questionForm.value;
      const currentStatus = this.questionForm.get('status')?.value;
      const questionId = this.questionId();
      let targetId: string;

      let currentMetadata: any = {};
      let originalCreator = user.id;

      if (this.editMode()) {
        const { data: qRecord } = await this.supabase.db
          .from('questions')
          .select('metadata, created_by')
          .eq('id', questionId!)
          .single();
        currentMetadata = qRecord?.metadata || {};
        originalCreator = qRecord?.created_by || user.id;
      }

      const questionData = {
        name: formValue.name,
        question_text: formValue.question_text,
        general_feedback: formValue.general_feedback,
        default_grade: formValue.default_grade,
        penalty: formValue.penalty,
        qtype: formValue.qtype,
        category_id: formValue.category_id || null,
        created_by: user.id,
        metadata: {
          ...currentMetadata,
          ...extraMetadata,
          shuffleanswers: formValue.shuffleanswers,
          answernumbering: formValue.answernumbering,
          image_url: formValue.image_url,
          // Preserve original author; only update who last modified
          author_name: currentMetadata.author_name || this.currentTeacher,
          modified_by: this.currentTeacher,
          modified_at: new Date().toISOString()
        }
      };

      // BRANCHING LOGIC:
      const forceNewVersion = this.editMode() && (
        currentStatus === 'approved' || 
        currentStatus === 'rejected' ||
        (!this.isAdmin && originalCreator !== user.id)
      );

      if (forceNewVersion) {
        const parentId = formValue.parent_id || questionId;
        
        // Find the maximum version in this family to ensure we always increment
        const { data: latestRecords } = await this.supabase.db
          .from('questions')
          .select('version')
          .or(`id.eq.${parentId},parent_id.eq.${parentId}`)
          .order('version', { ascending: false })
          .limit(1);

        const maxVersion = latestRecords?.[0]?.version || formValue.version || 1;
        const nextVersion = maxVersion + 1;
        
        console.log('Creating NEW VERSION based on max:', nextVersion);
        
        const { data: newQ, error: nError } = await this.supabase.db
          .from('questions')
          .insert({
            ...questionData,
            status: status,
            version: nextVersion,
            parent_id: parentId
          })
          .select()
          .single();

        if (nError) throw nError;
        targetId = newQ.id;
      } else if (this.editMode()) {
        console.log('Regular Update: Updating existing record ID:', questionId);
        // Regular update for existing drafts, rejected, or pending questions
        const { data: uData, error: uError } = await this.supabase.db
          .from('questions')
          .update({ ...questionData, status: status })
          .eq('id', questionId)
          .select();

        if (uError) throw uError;
        if (!uData || uData.length === 0) {
          throw new Error('Update failed. You may not have permission to modify this question.');
        }
        targetId = questionId!;

        // Refresh answers
        await this.supabase.db.from('answers').delete().eq('question_id', targetId);
      } else {
        // Brand new question
        const { data: newQ, error: iError } = await this.supabase.db
          .from('questions')
          .insert({
            ...questionData,
            status: status,
            version: 1
          })
          .select()
          .single();

        if (iError) throw iError;
        targetId = newQ.id;
      }

      // 2. Save Answers
      const answersToInsert = (formValue.answers as any[])?.map(ans => ({
        question_id: targetId,
        answer_text: ans.answer_text,
        fraction: ans.fraction,
        feedback: ans.feedback,
        x: ans.x || 0,
        y: ans.y || 0
      }));

      if (answersToInsert?.length) {
        const { error: ansError } = await this.supabase.db.from('answers').insert(answersToInsert);
        if (ansError) throw ansError;
      }

      // 3. Show success toast
      if (continueEditing) {
        this.showToast('Changes saved. You can continue editing.', 'success');
      } else if (status !== 'approved' && status !== 'rejected') {
        this.showToast(status === 'pending_review' ? 'Question submitted for review!' : 'Changes saved!');
      }
      
      // 4. Navigation logic
      if (continueEditing) {
        // Stay on the form — navigate to new ID if branched, otherwise just reload
        if (targetId !== questionId) {
          this.editMode.set(true);
          this.router.navigate(['/teacher/edit-question', targetId]).then(() => {
            this.loadQuestionData(targetId);
          });
        } else {
          this.loadQuestionData(targetId);
        }
      } else {
        // Navigate back to the dashboard
        this.router.navigate([this.isAdmin ? '/admin' : '/teacher']);
      }
      return true;
    } catch (err: any) {
      console.error(err);
      this.showToast('Error saving: ' + err.message, 'error');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  onSubmit() {
    this.submitForReview();
  }

  cancel() {
    this.router.navigate([this.isAdmin ? '/admin' : '/teacher']);
  }

  switchVersion(id: string) {
    this.router.navigate(['/teacher/edit-question', id]).then(() => {
      this.loadQuestionData(id);
    });
  }

  async approveQuestion() {
    if ((!this.isAdmin && !this.isAssignedReviewer) || !this.questionId()) return;
    
    const extraMetadata = {
      reviewed_by: this.supabase.currentUserName,
      reviewed_at: new Date().toISOString(),
      review_status: 'approved'
    };

    const success = await this.saveQuestion('approved', false, extraMetadata);
    if (success) {
      this.showToast('Question approved successfully!');
    }
  }

  async rejectQuestion() {
    if ((!this.isAdmin && !this.isAssignedReviewer) || !this.questionId()) return;
    const reason = prompt('Reason for rejection:');
    if (reason === null) return;

    const extraMetadata = {
      rejection_reason: reason,
      rejected_by: this.supabase.currentUserName,
      rejected_at: new Date().toISOString()
    };

    const success = await this.saveQuestion('rejected', false, extraMetadata);
    if (success) {
      this.showToast('Question rejected with feedback.');
    }
  }
}
