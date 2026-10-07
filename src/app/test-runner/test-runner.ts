import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PreTestService, TestingSubject, CandidateQuestion, TestSubmitResponse } from '../services/pre-test.service';

@Component({
  selector: 'app-test-runner',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './test-runner.html',
  styleUrls: ['./test-runner.css']
})
export class TestRunnerComponent implements OnInit, OnDestroy {
  preTestService = inject(PreTestService);

  // States
  stage = signal<'select_subject' | 'taking_test' | 'submitted'>('select_subject');
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  // Subject Selection State
  activeSubjects = signal<TestingSubject[]>([]);
  selectedSubjectId = signal<string>('');

  // Active Exam State
  sessionId = signal<string | null>(null);
  questions = signal<CandidateQuestion[]>([]);
  currentIndex = signal<number>(0);
  selectedAnswers = signal<Record<string, string | null>>({});
  flaggedQuestionIds = signal<Set<string>>(new Set());
  
  // Timer State
  elapsedSeconds = signal<number>(0);
  private timerInterval: any = null;

  // Submission Result State
  submitResult = signal<TestSubmitResponse | null>(null);
  showConfirmSubmitModal = signal(false);

  // Computed Properties
  currentQuestion = computed(() => {
    const list = this.questions();
    const idx = this.currentIndex();
    return list[idx] || null;
  });

  answeredCount = computed(() => {
    const answers = this.selectedAnswers();
    return Object.values(answers).filter(val => val !== null && val !== undefined).length;
  });

  unansweredCount = computed(() => {
    return this.questions().length - this.answeredCount();
  });

  progressPercentage = computed(() => {
    const total = this.questions().length;
    if (total === 0) return 0;
    return Math.round((this.answeredCount() / total) * 100);
  });

  formattedTime = computed(() => {
    const totalSecs = this.elapsedSeconds();
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  });

  selectedSubject = computed(() => {
    const subId = this.selectedSubjectId();
    return this.activeSubjects().find(s => s.id === subId) || null;
  });

  async ngOnInit() {
    await this.loadSubjects();
  }

  ngOnDestroy() {
    this.stopTimer();
  }

  async loadSubjects() {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const subjects = await this.preTestService.getActiveSubjects();
      this.activeSubjects.set(subjects);
      if (subjects.length > 0 && !this.selectedSubjectId()) {
        this.selectedSubjectId.set(subjects[0].id);
      }
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to load test subjects');
    } finally {
      this.loading.set(false);
    }
  }

  async startExam() {
    const subjectId = this.selectedSubjectId();
    if (!subjectId) {
      this.errorMessage.set('Please select a subject to begin.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const res = await this.preTestService.startExam(subjectId);
      if (!res.questions || res.questions.length === 0) {
        throw new Error('No questions available in the testing pool for this subject.');
      }

      this.sessionId.set(res.session_id);
      this.questions.set(res.questions);
      this.currentIndex.set(0);
      
      // Initialize answer map
      const initialAnswers: Record<string, string | null> = {};
      res.questions.forEach(q => {
        initialAnswers[q.id] = null;
      });
      this.selectedAnswers.set(initialAnswers);
      this.flaggedQuestionIds.set(new Set());

      // Start elapsed timer
      this.elapsedSeconds.set(0);
      this.startTimer();

      this.stage.set('taking_test');
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Unable to start test session');
    } finally {
      this.loading.set(false);
    }
  }

  selectOption(questionId: string, optionId: string) {
    const current = { ...this.selectedAnswers() };
    // Toggle or select
    current[questionId] = optionId;
    this.selectedAnswers.set(current);
  }

  clearSelection(questionId: string) {
    const current = { ...this.selectedAnswers() };
    current[questionId] = null;
    this.selectedAnswers.set(current);
  }

  toggleFlag(questionId: string) {
    const set = new Set(this.flaggedQuestionIds());
    if (set.has(questionId)) {
      set.delete(questionId);
    } else {
      set.add(questionId);
    }
    this.flaggedQuestionIds.set(set);
  }

  isFlagged(questionId: string): boolean {
    return this.flaggedQuestionIds().has(questionId);
  }

  goToQuestion(index: number) {
    if (index >= 0 && index < this.questions().length) {
      this.currentIndex.set(index);
    }
  }

  nextQuestion() {
    if (this.currentIndex() < this.questions().length - 1) {
      this.currentIndex.update(i => i + 1);
    }
  }

  prevQuestion() {
    if (this.currentIndex() > 0) {
      this.currentIndex.update(i => i - 1);
    }
  }

  promptSubmit() {
    this.showConfirmSubmitModal.set(true);
  }

  cancelSubmit() {
    this.showConfirmSubmitModal.set(false);
  }

  async confirmSubmit() {
    const sessId = this.sessionId();
    if (!sessId) return;

    this.showConfirmSubmitModal.set(false);
    this.loading.set(true);
    this.errorMessage.set(null);
    this.stopTimer();

    try {
      const answersList = Object.entries(this.selectedAnswers()).map(([question_id, selected_option_id]) => ({
        question_id,
        selected_option_id
      }));

      const result = await this.preTestService.submitExam(sessId, answersList);
      this.submitResult.set(result);
      this.stage.set('submitted');
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Failed to submit test');
      this.startTimer(); // Resume timer if failed
    } finally {
      this.loading.set(false);
    }
  }

  retakeCurrentExam() {
    this.submitResult.set(null);
    this.startExam();
  }

  chooseAnotherSubject() {
    this.stopTimer();
    this.submitResult.set(null);
    this.sessionId.set(null);
    this.questions.set([]);
    this.stage.set('select_subject');
    this.loadSubjects();
  }

  private startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds.update(s => s + 1);
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  getResultItem(questionId: string) {
    const res = this.submitResult();
    if (!res || !res.breakdown) return null;
    return res.breakdown.find(b => b.question_id === questionId) || null;
  }

  getOptionText(question: CandidateQuestion, optionId: string | null): string {
    if (!optionId) return '(Skipped / No Answer)';
    const opt = question.options.find(o => o.id === optionId);
    return opt ? opt.answer_text : '(Unknown option)';
  }
}
