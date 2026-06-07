'use client';

import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useComprehension } from './useComprehension';
import ComprehensionOfferDialog from './ComprehensionOfferDialog';
import ComprehensionQuestionDialog from './ComprehensionQuestionDialog';
import ComprehensionFeedbackDialog from './ComprehensionFeedbackDialog';
import ComprehensionResultsDialog from './ComprehensionResultsDialog';
import type { AISettings } from '@/services/ai/types';

interface ComprehensionControllerProps {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  aiSettings: AISettings | null;
  /** Parent calls this to hand off words after RSVP stops */
  onRegisterOffer: (offerFn: (words: string[]) => void) => void;
}

const ComprehensionController: React.FC<ComprehensionControllerProps> = ({
  bookHash,
  bookTitle,
  authorName,
  aiSettings,
  onRegisterOffer,
}) => {
  const _ = useTranslation();
  const { state, offer, startTest, answer, next, more, dismiss } = useComprehension(
    bookHash,
    bookTitle,
    authorName,
    aiSettings,
  );

  // Register the offer function so RSVPControl can trigger it
  React.useEffect(() => {
    onRegisterOffer(offer);
  }, [offer, onRegisterOffer]);

  const currentQuestion = state.questions[state.currentIndex];
  const lastResult = state.results[state.results.length - 1];
  const isLastQuestion = state.currentIndex === state.questions.length - 1;

  // Check error before the idle early-return: startTest sets phase back to
  // 'idle' on failure, so an error must be surfaced here or it's swallowed.
  if (state.error) {
    return (
      <div className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/60'>
        <div className='mx-4 w-full max-w-sm rounded-2xl bg-base-200 p-6 shadow-2xl'>
          <p className='mb-4 font-semibold text-error'>{_('Could not generate questions')}</p>
          <p className='mb-4 break-words text-sm opacity-70'>{state.error}</p>
          <button
            className='w-full cursor-pointer rounded-xl border border-gray-500/30 bg-transparent px-4 py-3 font-medium'
            onClick={dismiss}
          >
            {_('Close')}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'idle') return null;

  if (state.phase === 'generating') {
    return (
      <div className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/60'>
        <div className='rounded-2xl bg-base-200 px-8 py-6 text-center shadow-2xl'>
          <div className='mb-3 text-2xl'>💡</div>
          <p className='font-semibold'>{_('Generating questions…')}</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'offering') {
    return <ComprehensionOfferDialog onAccept={() => void startTest()} onDecline={dismiss} />;
  }

  if (state.phase === 'question' && currentQuestion) {
    return (
      <ComprehensionQuestionDialog
        question={currentQuestion}
        index={state.currentIndex}
        total={state.questions.length}
        onAnswer={answer}
      />
    );
  }

  if (state.phase === 'feedback' && lastResult) {
    return (
      <ComprehensionFeedbackDialog
        result={lastResult}
        isLast={isLastQuestion}
        onNext={next}
        onMore={more}
      />
    );
  }

  if (state.phase === 'results') {
    return (
      <ComprehensionResultsDialog
        results={state.results}
        lastPrompt={state.lastPrompt}
        onMore={more}
        onClose={dismiss}
      />
    );
  }

  return null;
};

export default ComprehensionController;
