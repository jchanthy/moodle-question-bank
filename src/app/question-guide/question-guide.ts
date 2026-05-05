import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface QuestionGuideItem {
  type: string;
  label: string;
  description: string;
  category: 'Standard' | 'Calculated' | 'Interactive' | 'Specialized';
  iconColor: string;
}

@Component({
  selector: 'app-question-guide',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './question-guide.html',
  styleUrl: './question-guide.css'
})
export class QuestionGuideComponent {
  guides: QuestionGuideItem[] = [
    // Standard
    {
      type: 'multichoice',
      label: 'Multiple Choice',
      category: 'Standard',
      description: 'Students select one or more correct answers from a list. It can be configured for single or multiple correct responses and is versatile for assessing knowledge across topics.',
      iconColor: 'bg-blue-500'
    },
    {
      type: 'truefalse',
      label: 'True/False',
      category: 'Standard',
      description: 'A simple binary-choice question where students determine if a statement is true or false, ideal for quick concept checks.',
      iconColor: 'bg-green-500'
    },
    {
      type: 'shortanswer',
      label: 'Short Answer',
      category: 'Standard',
      description: 'Requires a brief response, often a word or phrase. Multiple acceptable answers can be defined, and case sensitivity can be configured.',
      iconColor: 'bg-purple-500'
    },
    {
      type: 'numerical',
      label: 'Numerical',
      category: 'Standard',
      description: 'Students provide a numeric answer, which can include whole numbers, decimals, or fractions. Acceptable ranges can be set to allow minor variations.',
      iconColor: 'bg-orange-500'
    },
    {
      type: 'essay',
      label: 'Essay',
      category: 'Standard',
      description: 'Students write longer responses, which must be graded manually. Useful for assessing critical thinking and written communication.',
      iconColor: 'bg-red-500'
    },
    {
      type: 'match',
      label: 'Matching',
      category: 'Standard',
      description: 'Students pair items from two lists, such as terms and definitions, to assess understanding of relationships.',
      iconColor: 'bg-indigo-500'
    },
    // Calculated
    {
      type: 'calculated',
      label: 'Calculated',
      category: 'Calculated',
      description: 'Similar to numerical questions, but numbers are randomly selected from a set when the quiz is taken, allowing individualized questions.',
      iconColor: 'bg-cyan-500'
    },
    {
      type: 'calculatedmulti',
      label: 'Calculated Multichoice',
      category: 'Calculated',
      description: 'Combines multiple choice with calculated values, where answer options can include formula results from randomly selected numbers.',
      iconColor: 'bg-emerald-500'
    },
    {
      type: 'calculatedsimple',
      label: 'Calculated Simple',
      category: 'Calculated',
      description: 'A simplified version of calculated questions with a more user-friendly interface for creating numerical formula-based questions.',
      iconColor: 'bg-lime-500'
    },
    // Interactive
    {
      type: 'ddwtos',
      label: 'Drag and Drop into Text',
      category: 'Interactive',
      description: 'Students fill in missing words or phrases by dragging them into the correct location in a text passage.',
      iconColor: 'bg-teal-500'
    },
    {
      type: 'ddimageortext',
      label: 'Drag and Drop onto Image',
      category: 'Interactive',
      description: 'Students drag labels or markers onto specific areas of an image.',
      iconColor: 'bg-pink-500'
    },
    {
      type: 'ddmarker',
      label: 'Drag and Drop Matching',
      category: 'Interactive',
      description: 'Extends the matching question type by allowing items to be dragged to match sub-questions.',
      iconColor: 'bg-rose-500'
    },
    {
      type: 'ordering',
      label: 'Ordering',
      category: 'Interactive',
      description: 'Students arrange items in a correct sequence, useful for processes or chronological events.',
      iconColor: 'bg-amber-500'
    },
    // Specialized
    {
      type: 'coderunner',
      label: 'CodeRunner',
      category: 'Specialized',
      description: 'Allows students to write program code that is automatically graded by running tests in a sandbox environment.',
      iconColor: 'bg-gray-800'
    },
    {
      type: 'multichoiceanswernone',
      label: 'All-or-Nothing Multiple Choice',
      category: 'Specialized',
      description: 'A variation of multiple choice where students must select all correct answers to receive full credit; any incorrect selection results in zero points.',
      iconColor: 'bg-yellow-600'
    }
  ];

  get categories() {
    return ['Standard', 'Calculated', 'Interactive', 'Specialized'];
  }

  getGuidesByCategory(category: string) {
    return this.guides.filter(g => g.category === category);
  }
}
