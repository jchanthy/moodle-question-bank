export interface GuideExampleChoice {
  text: string;
  correct?: boolean;
  /** Optional label shown on the right (e.g. grade %, "Match", position) */
  note?: string;
}

export interface GuideExample {
  title: string;
  /** The question text exactly as the teacher would type it */
  questionText: string;
  /** Rows shown under the question (answers / pairs / items / gaps) */
  choicesLabel?: string;
  choices?: GuideExampleChoice[];
  /** Extra explanation of what the example demonstrates */
  explanation: string;
}

export interface QuestionGuideDetail {
  type: string;
  /** Short Khmer summary for teachers */
  khSummary: string;
  /** When to use this type */
  bestFor: string[];
  /** Step-by-step instructions in the question form */
  steps: string[];
  examples: GuideExample[];
  tips: string[];
  mistakes: string[];
}

export const QUESTION_GUIDE_DETAILS: Record<string, QuestionGuideDetail> = {
  multichoice: {
    type: 'multichoice',
    khSummary: 'សំណួរជ្រើសរើសចម្លើយ — សិស្សជ្រើសរើសចម្លើយត្រឹមត្រូវមួយ ឬច្រើនពីបញ្ជីជម្រើស។',
    bestFor: ['Testing knowledge, definitions and concepts', 'Quick, auto-graded quizzes and exams', 'Questions with one best answer or several correct answers'],
    steps: [
      'Choose Question Type → Multiple Choice.',
      'Type the question in "Question Text" (be clear and complete).',
      'Add 3–5 choices. Fill the text of each choice.',
      'Mark the correct choice. Keep "Single answer" ON when only one is correct; turn it OFF to allow several correct answers.',
      'Add General Feedback to explain why the answer is correct, then Submit for Review.'
    ],
    examples: [
      {
        title: 'Single correct answer',
        questionText: 'តើកម្មវិធីមួយណាត្រូវបានប្រើសម្រាប់បង្កើតតារាងគណនា (Spreadsheet)?',
        choicesLabel: 'Choices',
        choices: [
          { text: 'Microsoft Word', note: '0%' },
          { text: 'Microsoft Excel', correct: true, note: '100%' },
          { text: 'Microsoft PowerPoint', note: '0%' },
          { text: 'Microsoft Access', note: '0%' }
        ],
        explanation: 'One choice is 100%, the others are 0%. "Single answer" is ON, so students see radio buttons.'
      },
      {
        title: 'Multiple correct answers',
        questionText: 'ជ្រើសរើសឧបករណ៍បញ្ចូល (Input Device) ទាំងអស់ខាងក្រោម៖',
        choicesLabel: 'Choices',
        choices: [
          { text: 'Keyboard', correct: true, note: '50%' },
          { text: 'Monitor', note: '0%' },
          { text: 'Mouse', correct: true, note: '50%' },
          { text: 'Printer', note: '0%' }
        ],
        explanation: 'Turn "Single answer" OFF. Correct choices share 100% (two correct → 50% each). Students see checkboxes.'
      }
    ],
    tips: ['Make all choices similar in length and style.', 'Use plausible distractors based on common mistakes.', 'Avoid "All of the above" / "None of the above".'],
    mistakes: ['Correct choices do not add up to 100%.', 'Leaving two choices with the same meaning.', 'Giving away the answer through grammar or length.']
  },

  truefalse: {
    type: 'truefalse',
    khSummary: 'ពិត/មិនពិត — សិស្សសម្រេចថាប្រយោគមួយពិត ឬមិនពិត។',
    bestFor: ['Quick concept checks', 'Verifying facts or common misconceptions', 'Warm-up questions at the start of a quiz'],
    steps: [
      'Choose Question Type → True/False.',
      'Write the question as a clear statement that is either completely true or completely false.',
      'Select the correct answer (True or False). The two options are created automatically.',
      'Add feedback to explain why the statement is true or false.'
    ],
    examples: [
      {
        title: 'Statement question',
        questionText: 'RAM ជាអង្គចងចាំអចិន្ត្រៃយ៍ ដែលរក្សាទិន្នន័យបានទោះបិទកុំព្យូទ័រ។',
        choicesLabel: 'Answer',
        choices: [
          { text: 'True', note: '0%' },
          { text: 'False', correct: true, note: '100%' }
        ],
        explanation: 'RAM is volatile memory. Use the feedback to explain: "RAM loses data when power is off; ROM/storage keeps it."'
      }
    ],
    tips: ['Test one idea per statement.', 'Avoid absolute words like "always" / "never" unless intended.', 'Balance the number of True and False questions.'],
    mistakes: ['Statements that are partly true and partly false.', 'Double negatives that confuse students.']
  },

  shortanswer: {
    type: 'shortanswer',
    khSummary: 'ចម្លើយខ្លី — សិស្សវាយពាក្យ ឬឃ្លាខ្លីៗជាចម្លើយ។',
    bestFor: ['Recall of terms, names, abbreviations', 'Fill-in-the-blank style questions', 'When you want students to produce, not recognise, the answer'],
    steps: [
      'Choose Question Type → Short Answer.',
      'Write the question so that only a short word/phrase is needed.',
      'Add the best answer with 100%.',
      'Add other acceptable variations (spelling, abbreviations) with 100% or partial credit.',
      'Use * as a wildcard if needed (e.g. "Phnom*"). Check case-sensitivity setting.'
    ],
    examples: [
      {
        title: 'Several accepted answers',
        questionText: 'តើអក្សរកាត់ CPU មកពីពាក្យអ្វី?',
        choicesLabel: 'Accepted answers',
        choices: [
          { text: 'Central Processing Unit', correct: true, note: '100%' },
          { text: 'central processing unit', correct: true, note: '100%' },
          { text: 'Central Processor', note: '50%' },
          { text: '*', note: '0%' }
        ],
        explanation: 'List the correct answer and common variants. The final "*" with 0% catches every other answer.'
      }
    ],
    tips: ['Ask for one specific word or short phrase.', 'List abbreviations and alternative spellings.', 'Add Khmer and English variants if both are acceptable.'],
    mistakes: ['Forgetting to add acceptable spelling variants.', 'Asking questions that have many valid answers.']
  },

  numerical: {
    type: 'numerical',
    khSummary: 'ចម្លើយជាលេខ — សិស្សវាយចម្លើយជាលេខ ហើយអាចកំណត់កម្រិតលម្អៀង (Tolerance)។',
    bestFor: ['Math, physics, accounting and statistics problems', 'Questions where the answer is a number with a unit', 'Answers that allow rounding differences'],
    steps: [
      'Choose Question Type → Numerical.',
      'Write the problem with all needed values.',
      'Enter the correct number as the answer (100%).',
      'Set the Tolerance (error margin) so rounding differences are accepted.',
      'Optionally add units or extra accepted answers with partial credit.'
    ],
    examples: [
      {
        title: 'Number with tolerance',
        questionText: 'ក្រុមហ៊ុនមួយលក់ទំនិញបាន \$1,250 ហើយចំណាយ \$800។ តើប្រាក់ចំណេញស្មើប៉ុន្មាន (ដុល្លារ)?',
        choicesLabel: 'Answer',
        choices: [
          { text: '450', correct: true, note: '100% · tolerance 0' }
        ],
        explanation: 'Answer 450 with tolerance 0 means only 450 is accepted. For 3.14 use tolerance 0.01 to accept 3.13–3.15.'
      }
    ],
    tips: ['State the required unit and rounding in the question.', 'Use tolerance for decimals.', 'Use General Feedback to show the worked solution.'],
    mistakes: ['Tolerance too small for decimal answers.', 'Typing units or commas inside the answer value.']
  },

  essay: {
    type: 'essay',
    khSummary: 'អត្ថបទវែង — សិស្សសរសេរចម្លើយវែង ហើយគ្រូដាក់ពិន្ទុដោយដៃ។',
    bestFor: ['Critical thinking, explanations and opinions', 'Case studies and reflections', 'Assessments that need rubric-based grading'],
    steps: [
      'Choose Question Type → Essay.',
      'Write a clear task with the expected length and focus.',
      'Add a grading guide / model answer in General Feedback (visible to graders).',
      'Remember: essay questions are NOT auto-graded.'
    ],
    examples: [
      {
        title: 'Open task with rubric',
        questionText: 'ពន្យល់អំពីសារៈសំខាន់នៃសុវត្ថិភាពព័ត៌មាន (Information Security) សម្រាប់ស្ថាប័នអប់រំ។ សូមលើកឧទាហរណ៍យ៉ាងតិច ២ ។ (ប្រវែង ១៥០–២០០ ពាក្យ)',
        choicesLabel: 'Grading guide (example)',
        choices: [
          { text: 'Explains confidentiality, integrity, availability', note: '4 pts' },
          { text: 'Gives at least 2 relevant examples', note: '4 pts' },
          { text: 'Clear structure and language', note: '2 pts' }
        ],
        explanation: 'Put the rubric in feedback so every grader marks consistently.'
      }
    ],
    tips: ['Specify word count and number of points to cover.', 'Use verbs like "explain", "compare", "justify".'],
    mistakes: ['Vague prompts such as "Talk about IT".', 'No rubric, which leads to inconsistent grading.']
  },

  match: {
    type: 'match',
    khSummary: 'ផ្គូផ្គង — សិស្សផ្គូផ្គងធាតុខាងឆ្វេងជាមួយចម្លើយខាងស្តាំ។',
    bestFor: ['Terms and definitions', 'Acronyms and full names', 'Countries/capitals, tools/functions'],
    steps: [
      'Choose Question Type → Matching.',
      'Write an instruction such as "Match each term with its definition".',
      'For each row, fill the left "Question" item and its correct "Match" on the right.',
      'Add at least 3 pairs. You may add extra right-side distractors by leaving the left side empty.',
      'Moodle shuffles the right-side options automatically.'
    ],
    examples: [
      {
        title: 'Terms and definitions',
        questionText: 'ផ្គូផ្គងពាក្យបច្ចេកទេសនីមួយៗជាមួយនិយមន័យត្រឹមត្រូវ។',
        choicesLabel: 'Pairs',
        choices: [
          { text: 'CPU', correct: true, note: '→ អង្គដំណើរការកណ្តាល' },
          { text: 'RAM', correct: true, note: '→ អង្គចងចាំបណ្តោះអាសន្ន' },
          { text: 'SSD', correct: true, note: '→ ឧបករណ៍ផ្ទុកទិន្នន័យ' },
          { text: '(empty)', note: '→ ម៉ូនីទ័រ (distractor)' }
        ],
        explanation: 'Each left item has exactly one right-side match. The last row is a distractor with no left item.'
      }
    ],
    tips: ['Keep items on the same topic.', 'Use 4–8 pairs.', 'Keep the right-side text short.'],
    mistakes: ['Items that could match more than one answer.', 'Using only two pairs (too easy to guess).']
  },

  calculated: {
    type: 'calculated',
    khSummary: 'ការគណនា — លេខត្រូវបានជ្រើសចៃដន្យពី Dataset ដើម្បីឱ្យសិស្សម្នាក់ៗទទួលបានលេខផ្សេងគ្នា។',
    bestFor: ['Math/physics/finance with different numbers per student', 'Reducing cheating in online exams'],
    steps: [
      'Choose Question Type → Calculated.',
      'Write the question using wildcards in curly braces, e.g. {a} and {b}.',
      'Add the answer formula, e.g. {a} + {b}.',
      'Set tolerance and the number of decimal places.',
      'Define the wildcard dataset (min / max range) so Moodle can generate random values.'
    ],
    examples: [
      {
        title: 'Rectangle area',
        questionText: 'ចតុកោណកែងមួយមានបណ្តោយ {l} ម៉ែត្រ និងទទឹង {w} ម៉ែត្រ។ គណនាក្រឡាផ្ទៃ (ម៉ែត្រការ៉េ)។',
        choicesLabel: 'Answer formula',
        choices: [
          { text: '{l} * {w}', correct: true, note: '100% · tolerance 0.01' }
        ],
        explanation: 'Wildcards {l} (5–20) and {w} (2–10) get random values for each student, and the answer is calculated automatically.'
      }
    ],
    tips: ['Use clear wildcard names ({l}, {w}, {rate}).', 'Make sure the generated values give sensible answers.'],
    mistakes: ['Using a wildcard in the question but not defining its range.', 'Division that can produce zero.']
  },

  calculatedmulti: {
    type: 'calculatedmulti',
    khSummary: 'ការគណនាជាជម្រើស — ដូច Calculated ប៉ុន្តែចម្លើយជាជម្រើស Multiple Choice។',
    bestFor: ['Calculation problems that should be graded as multiple choice', 'Showing common calculation mistakes as distractors'],
    steps: [
      'Choose Question Type → Calc. Multichoice.',
      'Write the question with wildcards such as {x}.',
      'Create choices using formulas, e.g. {x} * 2.',
      'Mark the choice whose formula gives the correct result as 100%.',
      'Define the dataset ranges for the wildcards.'
    ],
    examples: [
      {
        title: 'Discount calculation',
        questionText: 'ទំនិញមួយតម្លៃ \${price} ត្រូវបានបញ្ចុះតម្លៃ 10%។ តើតម្លៃបន្ទាប់ពីបញ្ចុះគឺប៉ុន្មាន?',
        choicesLabel: 'Choices (formulas)',
        choices: [
          { text: '{price} * 0.9', correct: true, note: '100%' },
          { text: '{price} * 0.1', note: '0%' },
          { text: '{price} - 10', note: '0%' },
          { text: '{price} / 0.9', note: '0%' }
        ],
        explanation: 'Distractors are common mistakes (forgetting to subtract, subtracting a flat 10, dividing).'
      }
    ],
    tips: ['Design distractors from real student errors.', 'Use the same wildcard names in all choices.'],
    mistakes: ['A distractor accidentally equals the correct value for some random numbers.']
  },

  calculatedsimple: {
    type: 'calculatedsimple',
    khSummary: 'ការគណនាសាមញ្ញ — បង្កើតសំណួរគណនាដោយមិនបាច់គ្រប់គ្រង Dataset ស្មុគស្មាញ។',
    bestFor: ['Teachers new to calculated questions', 'Simple formula-based questions'],
    steps: [
      'Choose Question Type → Calc. Simple.',
      'Write the question using wildcards like {a} and {b}.',
      'Enter the formula answer, e.g. {a} * {b}.',
      'Moodle generates the dataset values for you; set the tolerance.'
    ],
    examples: [
      {
        title: 'Simple multiplication',
        questionText: 'សិស្ស {a} នាក់ ម្នាក់ៗទិញសៀវភៅ {b} ក្បាល។ តើសរុបទិញបានប៉ុន្មានក្បាល?',
        choicesLabel: 'Answer formula',
        choices: [{ text: '{a} * {b}', correct: true, note: '100%' }],
        explanation: 'The simplest way to create random-number questions without managing datasets.'
      }
    ],
    tips: ['Start with 2 wildcards only.', 'Preview several generated values before saving.'],
    mistakes: ['Using the same wildcard name for different meanings.']
  },

  ddwtos: {
    type: 'ddwtos',
    khSummary: 'អូសពាក្យចូលក្នុងអត្ថបទ — សិស្សអូសពាក្យទៅដាក់ក្នុងចន្លោះទទេ។',
    bestFor: ['Completing sentences/paragraphs', 'Vocabulary and terminology in context', 'Process descriptions'],
    steps: [
      'Choose Question Type → Drag and Drop into Text.',
      'Write the text and mark each gap with [[1]], [[2]], [[3]]...',
      'In the choices list, add the draggable words. Choice number n fills gap [[n]].',
      'Add extra (decoy) words that do not belong to any gap if you want.',
      'Check that each gap number matches its correct choice.'
    ],
    examples: [
      {
        title: 'Complete the sentence',
        questionText: '[[1]] គឺជាខួរក្បាលរបស់កុំព្យូទ័រ ហើយ [[2]] ត្រូវបានប្រើសម្រាប់ផ្ទុកទិន្នន័យអចិន្ត្រៃយ៍។',
        choicesLabel: 'Draggable choices',
        choices: [
          { text: 'CPU', correct: true, note: 'Gap [[1]]' },
          { text: 'Hard Disk', correct: true, note: 'Gap [[2]]' },
          { text: 'Monitor', note: 'Decoy' }
        ],
        explanation: '[[1]] is filled by choice 1 (CPU) and [[2]] by choice 2 (Hard Disk). "Monitor" is a decoy.'
      }
    ],
    tips: ['Keep draggable words short.', 'Use 1–2 decoys for harder questions.'],
    mistakes: ['Gap numbers that do not exist in the choices list.', 'Forgetting the double square brackets.']
  },

  ddimageortext: {
    type: 'ddimageortext',
    khSummary: 'អូសអក្សរលើរូបភាព — សិស្សអូសស្លាកទៅដាក់លើតំបន់ត្រឹមត្រូវនៃរូបភាព។',
    bestFor: ['Labelling diagrams (computer parts, network topology)', 'Maps and charts', 'Interface/screenshot identification'],
    steps: [
      'Choose Question Type → Drag and Drop onto Image.',
      'Upload a clear background image first.',
      'Add the draggable labels (text or small images).',
      'Drag each label onto the image to set its correct "home" position.',
      'Preview on different screen sizes.'
    ],
    examples: [
      {
        title: 'Label the motherboard',
        questionText: 'អូសឈ្មោះសមាសធាតុទៅដាក់លើទីតាំងត្រឹមត្រូវនៅលើរូប Motherboard។',
        choicesLabel: 'Labels → drop zones',
        choices: [
          { text: 'CPU Socket', correct: true, note: 'Zone 1 (top centre)' },
          { text: 'RAM Slot', correct: true, note: 'Zone 2 (right)' },
          { text: 'PCI Slot', correct: true, note: 'Zone 3 (bottom)' }
        ],
        explanation: 'Upload the motherboard image, then place each label over the part it names.'
      }
    ],
    tips: ['Use high-contrast images with clearly separated parts.', 'Keep labels short.'],
    mistakes: ['Low resolution images.', 'Drop zones that overlap each other.']
  },

  ddmarker: {
    type: 'ddmarker',
    khSummary: 'អូសសញ្ញាសម្គាល់ — សិស្សដាក់សញ្ញាសម្គាល់លើតំបន់គោលដៅនៃរូបភាព។',
    bestFor: ['Anatomy, geography and maps', 'Pointing to locations on a diagram'],
    steps: [
      'Choose Question Type → Drag Matching (Drag and Drop Markers).',
      'Upload a background image.',
      'Add marker names (the draggable items).',
      'Draw the drop zones (circle, rectangle or polygon) for each marker.',
      'Test that the zones are large enough to drop on.'
    ],
    examples: [
      {
        title: 'Map of Cambodia',
        questionText: 'សូមអូសសញ្ញាសម្គាល់ទៅកាន់ទីតាំងត្រឹមត្រូវនៅលើផែនទីកម្ពុជា។',
        choicesLabel: 'Markers → zones',
        choices: [
          { text: 'Phnom Penh', correct: true, note: 'Circle zone' },
          { text: 'Siem Reap', correct: true, note: 'Circle zone' },
          { text: 'Sihanoukville', correct: true, note: 'Circle zone' }
        ],
        explanation: 'Each marker has one correct zone drawn on the map.'
      }
    ],
    tips: ['Make zones slightly larger than the target.', 'Use polygons for irregular shapes.'],
    mistakes: ['Too small zones that are hard to hit on mobile.']
  },

  ordering: {
    type: 'ordering',
    khSummary: 'តម្រៀបលំដាប់ — សិស្សតម្រៀបធាតុតាមលំដាប់ត្រឹមត្រូវ។',
    bestFor: ['Steps in a process or procedure', 'Chronological events', 'Algorithm or workflow order'],
    steps: [
      'Choose Question Type → Ordering.',
      'Write the instruction (e.g. "Arrange the steps in the correct order").',
      'Enter the items in the CORRECT order from top to bottom.',
      'Moodle shuffles them for students automatically.'
    ],
    examples: [
      {
        title: 'Steps to send an email',
        questionText: 'តម្រៀបជំហានខាងក្រោមតាមលំដាប់ត្រឹមត្រូវនៃការផ្ញើអ៊ីមែល។',
        choicesLabel: 'Items in correct order',
        choices: [
          { text: 'បើកគណនីអ៊ីមែល', note: '1' },
          { text: 'ចុច Compose', note: '2' },
          { text: 'វាយអាសយដ្ឋាន និងខ្លឹមសារ', note: '3' },
          { text: 'ចុច Send', note: '4' }
        ],
        explanation: 'Type items in the right sequence — the system shuffles them for students.'
      }
    ],
    tips: ['Use 4–7 items.', 'Each item must clearly belong at one position only.'],
    mistakes: ['Steps that can validly be done in a different order.']
  },

  gapselect: {
    type: 'gapselect',
    khSummary: 'ជ្រើសពាក្យខ្វះ — សិស្សជ្រើសពាក្យពីម៉ឺនុយទម្លាក់ចុះ (Dropdown) ក្នុងចន្លោះទទេ។',
    bestFor: ['Sentence completion with limited options', 'Grammar/vocabulary and terminology', 'When drag-and-drop is not suitable on mobile'],
    steps: [
      'Choose Question Type → Select Missing Words.',
      'Write the text and mark gaps with [[1]], [[2]]...',
      'Add the choices; choice n is the correct answer for gap [[n]].',
      'Optionally group choices so each dropdown only shows relevant options.'
    ],
    examples: [
      {
        title: 'Dropdown completion',
        questionText: 'Protocol [[1]] ត្រូវបានប្រើសម្រាប់បើកគេហទំព័រដែលមានសុវត្ថិភាព ហើយ [[2]] ប្រើសម្រាប់ផ្ញើអ៊ីមែល។',
        choicesLabel: 'Choices',
        choices: [
          { text: 'HTTPS', correct: true, note: 'Gap [[1]]' },
          { text: 'SMTP', correct: true, note: 'Gap [[2]]' },
          { text: 'FTP', note: 'Decoy' }
        ],
        explanation: 'Students pick the answer from a dropdown in each gap.'
      }
    ],
    tips: ['Use the same group for choices that fit the same gap type.'],
    mistakes: ['Gap number does not match the choice number.']
  },

  gapfill: {
    type: 'gapfill',
    khSummary: 'បំពេញចន្លោះ — សរសេរពាក្យត្រឹមត្រូវក្នុងវង់ក្រចក [ ] ដើម្បីបង្កើតចន្លោះទទេ។',
    bestFor: ['Fill-in-the-blank sentences', 'Vocabulary and technical terms', 'Mixing typed answers, dropdowns or drag-drop'],
    steps: [
      'Choose Question Type → Gap Fill.',
      'Type the full sentence and put the correct word inside square brackets, e.g. [cat].',
      'Each bracketed word automatically becomes a gap for students.',
      'Add decoy words in the answers field (optional) to make drag-drop or dropdown harder.'
    ],
    examples: [
      {
        title: 'Technical terms',
        questionText: '[CPU] ជាអង្គដំណើរការកណ្តាល ហើយ [RAM] ជាអង្គចងចាំបណ្តោះអាសន្នរបស់កុំព្យូទ័រ។',
        choicesLabel: 'Gaps created',
        choices: [
          { text: 'CPU', correct: true, note: 'Gap 1' },
          { text: 'RAM', correct: true, note: 'Gap 2' },
          { text: 'ROM', note: 'Decoy (optional)' }
        ],
        explanation: 'Words in [ ] become gaps. Students type, select or drag the answer depending on the display mode.'
      }
    ],
    tips: ['Put only the key word in brackets.', 'Avoid gaps for very common words like "the".'],
    mistakes: ['Forgetting the closing bracket.', 'Putting whole sentences inside one bracket.']
  },

  multianswer: {
    type: 'multianswer',
    khSummary: 'ចម្លើយបង្កប់ (Cloze) — ដាក់សំណួរតូចៗច្រើនប្រភេទក្នុងអត្ថបទតែមួយ។',
    bestFor: ['Reading comprehension with several sub-questions', 'Mixing multiple choice, short answer and numerical inside one passage', 'Advanced users comfortable with syntax'],
    steps: [
      'Choose Question Type → Embedded Answers (Cloze).',
      'Write the passage normally.',
      'Insert sub-questions using the syntax {marks:TYPE:answers}.',
      'Types: MC (dropdown), MCV (vertical radio), MCH (horizontal radio), SA (short answer), NM (numerical).',
      'Inside answers: use = before the correct one and ~ to separate options.'
    ],
    examples: [
      {
        title: 'Mixed sub-questions',
        questionText: 'ទីក្រុងដែលជារដ្ឋធានីនៃកម្ពុជាគឺ {1:SA:=Phnom Penh} ហើយប្រទេសនេះមានខេត្តសរុប {1:NM:=25} (រួមទាំងរាជធានី)។ ភាសាផ្លូវការគឺ {1:MC:Thai~=Khmer~Vietnamese}។',
        choicesLabel: 'Syntax breakdown',
        choices: [
          { text: '{1:SA:=Phnom Penh}', correct: true, note: 'Short answer, 1 mark' },
          { text: '{1:NM:=25}', correct: true, note: 'Numerical, 1 mark' },
          { text: '{1:MC:Thai~=Khmer~Vietnamese}', correct: true, note: 'Dropdown, = marks correct' }
        ],
        explanation: 'Each {…} becomes an input inside the sentence. "=" marks the correct option and "~" separates options.'
      }
    ],
    tips: ['Build and test one sub-question at a time.', 'Keep marks consistent across sub-questions.'],
    mistakes: ['Missing } or ~ in the syntax.', 'No = on any correct option.']
  },

  coderunner: {
    type: 'coderunner',
    khSummary: 'សរសេរកូដ — សិស្សសរសេរកម្មវិធី ហើយប្រព័ន្ធដំណើរការតេស្តដើម្បីដាក់ពិន្ទុដោយស្វ័យប្រវត្តិ។',
    bestFor: ['Programming courses (Python, Java, C++, PHP...)', 'Automatic grading of code with test cases'],
    steps: [
      'Choose Question Type → CodeRunner.',
      'Write the programming task and required function/program name.',
      'Choose the correct language type (e.g. python3).',
      'Add test cases: input and expected output.',
      'Optionally provide an answer template and a sample solution.'
    ],
    examples: [
      {
        title: 'Python function',
        questionText: 'សរសេរ function ឈ្មោះ square(n) ដែលត្រឡប់ n គុណនឹង n។',
        choicesLabel: 'Test cases',
        choices: [
          { text: 'print(square(3))', correct: true, note: 'Expected: 9' },
          { text: 'print(square(-4))', correct: true, note: 'Expected: 16' },
          { text: 'print(square(0))', correct: true, note: 'Expected: 0' }
        ],
        explanation: 'Each test case runs the student code and compares the output with the expected result.'
      }
    ],
    tips: ['Include normal and edge-case tests.', 'State the exact function name and signature.'],
    mistakes: ['Expected output has trailing spaces or different format.', 'Choosing the wrong language type.']
  },

  multichoiceanswernone: {
    type: 'multichoiceanswernone',
    khSummary: 'ជ្រើសរើសទាំងអស់ត្រូវ — ទទួលពិន្ទុពេញតែនៅពេលជ្រើសរើសចម្លើយត្រូវទាំងអស់ និងមិនជ្រើសខុស។',
    bestFor: ['Safety / compliance knowledge where partial answers are not acceptable', 'Checklists (select all that apply)'],
    steps: [
      'Choose Question Type → All-or-Nothing MCQ.',
      'Write the question as "Select ALL that apply".',
      'Mark every correct choice.',
      'Students get full credit only if they select all correct choices and no wrong ones.'
    ],
    examples: [
      {
        title: 'Select all that apply',
        questionText: 'ជ្រើសរើសទម្លាប់ទាំងអស់ដែលជួយបង្កើនសុវត្ថិភាពពាក្យសម្ងាត់៖',
        choicesLabel: 'Choices',
        choices: [
          { text: 'ប្រើពាក្យសម្ងាត់វែង និងស្មុគស្មាញ', correct: true },
          { text: 'បើក Two-Factor Authentication', correct: true },
          { text: 'ប្រើពាក្យសម្ងាត់ដូចគ្នាគ្រប់គណនី' },
          { text: 'ចែករំលែកពាក្យសម្ងាត់ជាមួយមិត្តភក្តិ' }
        ],
        explanation: 'Both correct choices must be selected and no incorrect ones, otherwise the score is 0.'
      }
    ],
    tips: ['Tell students clearly that more than one answer is correct.', 'Use for critical knowledge only — it is strict.'],
    mistakes: ['Marking only one choice as correct (use normal Multiple Choice instead).']
  }
};

export const QUESTION_GUIDE_ORDER: { type: string; label: string; icon: string; color: string }[] = [
  { type: 'multichoice', label: 'Multiple Choice', icon: '🔘', color: 'bg-blue-500' },
  { type: 'truefalse', label: 'True/False', icon: '✅', color: 'bg-green-500' },
  { type: 'shortanswer', label: 'Short Answer', icon: '✏️', color: 'bg-purple-500' },
  { type: 'numerical', label: 'Numerical', icon: '🔢', color: 'bg-orange-500' },
  { type: 'essay', label: 'Essay', icon: '📝', color: 'bg-red-500' },
  { type: 'match', label: 'Matching', icon: '🔗', color: 'bg-indigo-500' },
  { type: 'calculated', label: 'Calculated', icon: '🧮', color: 'bg-cyan-500' },
  { type: 'calculatedmulti', label: 'Calculated Multichoice', icon: '🧮', color: 'bg-emerald-500' },
  { type: 'calculatedsimple', label: 'Calculated Simple', icon: '🧮', color: 'bg-lime-500' },
  { type: 'ddwtos', label: 'Drag and Drop into Text', icon: '📋', color: 'bg-teal-500' },
  { type: 'ddimageortext', label: 'Drag and Drop onto Image', icon: '🖼️', color: 'bg-pink-500' },
  { type: 'ddmarker', label: 'Drag and Drop Matching', icon: '📌', color: 'bg-rose-500' },
  { type: 'ordering', label: 'Ordering', icon: '↕️', color: 'bg-amber-500' },
  { type: 'gapselect', label: 'Select Missing Words', icon: '🔠', color: 'bg-violet-500' },
  { type: 'gapfill', label: 'Gap Fill', icon: '📝', color: 'bg-emerald-600' },
  { type: 'multianswer', label: 'Embedded Answers (Cloze)', icon: '🧩', color: 'bg-indigo-600' },
  { type: 'coderunner', label: 'CodeRunner', icon: '💻', color: 'bg-gray-800' },
  { type: 'multichoiceanswernone', label: 'All-or-Nothing Multiple Choice', icon: '❗', color: 'bg-yellow-600' }
];
