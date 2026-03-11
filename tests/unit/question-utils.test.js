import { describe, it, expect } from 'vitest';
import { getQuestionDisplayParts } from '../../public/question-utils.js';

describe('getQuestionDisplayParts', () => {
  it('hides the header when it duplicates the question text', () => {
    expect(getQuestionDisplayParts({
      header: 'Proceed?',
      question: 'Proceed?'
    })).toEqual({
      header: '',
      question: 'Proceed?'
    });
  });

  it('preserves a distinct header', () => {
    expect(getQuestionDisplayParts({
      header: 'Confirm action',
      question: 'Proceed?'
    })).toEqual({
      header: 'Confirm action',
      question: 'Proceed?'
    });
  });

  it('treats whitespace-only differences as duplicates', () => {
    expect(getQuestionDisplayParts({
      header: '  Proceed?  ',
      question: 'Proceed?'
    })).toEqual({
      header: '',
      question: 'Proceed?'
    });
  });
});
