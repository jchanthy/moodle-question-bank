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
      await this.saveQuestion('pending_review');
    } else {
      // If already a draft or pending, just update it to pending_review
      await this.submitForReview();
    }
  }

  async saveDraft() {
    await this.saveQuestion('draft');
  }

  async submitForReview() {
    await this.saveQuestion('pending_review');
  }

  async markAsReady() {
    await this.saveQuestion('approved');
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

  private async saveQuestion(status: 'draft' | 'pending_review' | 'approved') {
    if (this.questionForm.invalid) return;
    this.loading.set(true);
    try {
      const user = this.supabase.currentUser();
      if (!user) throw new Error('User not authenticated');

      const formValue: any = this.questionForm.value;
      const currentStatus = this.questionForm.get('status')?.value;
      const questionId = this.questionId();
      let targetId: string;

      const currentMetadata = this.editMode()
        ? (await this.supabase.db.from('questions').select('metadata').eq('id', questionId!).single()).data?.metadata || {}
        : {};

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
      if (this.editMode() && currentStatus === 'approved') {
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
        const { error: uError } = await this.supabase.db
          .from('questions')
          .update({ ...questionData, status: status })
          .eq('id', questionId);

        if (uError) throw uError;
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

      this.showToast(status === 'pending_review' ? 'Question submitted for review!' : 'Draft saved!');
      
      if (status === 'pending_review') {
        this.router.navigate(['/teacher']);
      } else {
        // Reload the page with the new ID if we branched
        if (targetId !== questionId) {
          this.router.navigate(['/teacher/edit-question', targetId]).then(() => {
            this.loadQuestionData(targetId);
          });
        } else {
          this.loadQuestionData(targetId);
        }
      }
    } catch (err: any) {
      this.showToast('Error: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  onSubmit() {
    this.submitForReview();
  }

  cancel() {
    this.router.navigate(['/teacher']);
  }

  switchVersion(id: string) {
    this.router.navigate(['/teacher/edit-question', id]).then(() => {
      this.loadQuestionData(id);
    });
  }

  async approveQuestion() {
    if (!this.isAdmin || !this.questionId()) return;
    this.loading.set(true);
    try {
      const { error } = await this.supabase.db
        .from('questions')
        .update({ status: 'approved' })
        .eq('id', this.questionId());
      if (error) throw error;
      this.showToast('Question approved successfully!');
      this.router.navigate(['/admin']);
    } catch (err: any) {
      this.showToast('Error: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async rejectQuestion() {
    if (!this.isAdmin || !this.questionId()) return;
    const reason = prompt('Reason for rejection:');
    if (reason === null) return;

    this.loading.set(true);
    try {
      const { error } = await this.supabase.db
        .from('questions')
        .update({ status: 'rejected' })
        .eq('id', this.questionId());
      if (error) throw error;
      this.showToast('Question rejected.');
      this.router.navigate(['/admin']);
    } catch (err: any) {
      this.showToast('Error: ' + err.message, 'error');
    } finally {
      this.loading.set(false);
    }
  }
}
