import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, FormArray } from '@angular/forms';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-question-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './question-form.html',
  styleUrl: './question-form.css'
})
export class QuestionFormComponent {
  private fb = inject(FormBuilder);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  loading = signal(false);

  // Define the form
  questionForm = this.fb.group({
    name: ['', Validators.required],
    question_text: ['', Validators.required],
    qtype: ['multichoice', Validators.required],
    default_grade: [1.0, [Validators.required, Validators.min(0)]],
    penalty: [0.33, [Validators.required, Validators.min(0), Validators.max(1)]],
    general_feedback: [''],
    // Metadata for multichoice
    shuffleanswers: [true],
    answernumbering: ['abc'],
    // Answers array
    answers: this.fb.array([
      this.createAnswer(100), // One correct by default
      this.createAnswer(0)    // One wrong by default
    ])
  });

  get answers() {
    return this.questionForm.get('answers') as FormArray;
  }

  createAnswer(fraction = 0) {
    return this.fb.group({
      answer_text: ['', Validators.required],
      fraction: [fraction, Validators.required],
      feedback: ['']
    });
  }

  addAnswer() {
    this.answers.push(this.createAnswer(0));
  }

  removeAnswer(index: number) {
    if (this.answers.length > 2) {
      this.answers.removeAt(index);
    }
  }

  async onSubmit() {
    if (this.questionForm.invalid) return;

    this.loading.set(true);
    const formValue = this.questionForm.value;

    try {
      const user = this.supabase.currentUser();
      if (!user) throw new Error('User not authenticated');

      // 1. Insert Question
      const { data: question, error: qError } = await this.supabase.db
        .from('questions')
        .insert({
          name: formValue.name,
          question_text: formValue.question_text,
          general_feedback: formValue.general_feedback,
          default_grade: formValue.default_grade,
          penalty: formValue.penalty,
          qtype: formValue.qtype,
          status: 'pending_review',
          created_by: user.id,
          metadata: {
            shuffleanswers: formValue.shuffleanswers,
            answernumbering: formValue.answernumbering
          }
        })
        .select()
        .single();

      if (qError) throw qError;

      // 2. Insert Answers (Choices)
      const answersToInsert = formValue.answers?.map((ans: any) => ({
        question_id: question.id,
        answer_text: ans.answer_text,
        fraction: ans.fraction,
        feedback: ans.feedback
      }));

      if (answersToInsert && answersToInsert.length > 0) {
        const { error: aError } = await this.supabase.db
          .from('answers')
          .insert(answersToInsert);
        
        if (aError) throw aError;
      }

      console.log('Question and answers created successfully');
      this.router.navigate(['/teacher']);
    } catch (error: any) {
      console.error('Submission error:', error);
      alert(`Submission failed: ${error.message || 'Unknown error'}`);
    } finally {
      this.loading.set(false);
    }
  }

  cancel() {
    this.router.navigate(['/teacher']);
  }
}
