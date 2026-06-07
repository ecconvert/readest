'use client';

import React from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { IoCheckmarkCircle, IoCloseCircle } from 'react-icons/io5';
import type { ComprehensionResult } from '@/services/comprehension';

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

interface ComprehensionFeedbackDialogProps {
  result: ComprehensionResult;
  isLast: boolean;
  onNext: () => void;
  onMore: () => void;
  onReview: (result: ComprehensionResult) => void;
  reviewText: string | null;
  reviewLoading: boolean;
}

const ComprehensionFeedbackDialog: React.FC<ComprehensionFeedbackDialogProps> = ({
  result,
  isLast,
  onNext,
  onMore,
  onReview,
  reviewText,
  reviewLoading,
}) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode } = useThemeStore();
  const bgColor = themeCode.palette['base-200'] || themeCode.bg;
  const fgColor = themeCode.fg;
  const accentColor = themeCode.primary;
  const backdropColor = isDarkMode ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';
  const correctColor = '#22c55e';
  const wrongColor = '#ef4444';

  return (
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center'
      style={{ backgroundColor: backdropColor }}
      role='presentation'
    >
      <div
        className='mx-4 w-full max-w-md rounded-2xl p-6 shadow-2xl'
        style={{ backgroundColor: bgColor, color: fgColor }}
        role='dialog'
        aria-modal='true'
      >
        {/* Correct / Wrong heading */}
        <div className='mb-4 flex items-center gap-3'>
          {result.isCorrect ? (
            <IoCheckmarkCircle size={28} color={correctColor} />
          ) : (
            <IoCloseCircle size={28} color={wrongColor} />
          )}
          <span
            className='text-lg font-bold'
            style={{ color: result.isCorrect ? correctColor : wrongColor }}
          >
            {result.isCorrect ? _('Correct!') : _('Wrong')}
          </span>
        </div>

        {/* Show correct answer when wrong */}
        {!result.isCorrect && (
          <div className='mb-3 rounded-xl bg-gray-500/10 px-4 py-3 text-sm'>
            <span className='font-semibold opacity-60'>{_('Correct answer: ')}</span>
            <span>
              {OPTION_LABELS[result.correct]}. {result.options[result.correct]}
            </span>
          </div>
        )}

        {/* Explanation */}
        {result.explanation && <p className='mb-5 text-sm opacity-70'>{result.explanation}</p>}

        {/* Ask the AI to double-check a wrong answer (mis-keyed / ambiguous question) */}
        {!result.isCorrect && (
          <div className='mb-5'>
            {reviewText ? (
              <div className='eink-bordered rounded-xl bg-gray-500/10 px-4 py-3 text-sm'>
                <p className='mb-1 font-semibold opacity-60'>{_('AI review')}</p>
                <p className='whitespace-pre-wrap opacity-80'>{reviewText}</p>
              </div>
            ) : (
              <button
                className='eink-bordered w-full cursor-pointer rounded-xl border border-gray-500/30 bg-transparent px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-500/10 disabled:cursor-default disabled:opacity-50'
                style={{ color: fgColor }}
                onClick={() => onReview(result)}
                disabled={reviewLoading}
              >
                {reviewLoading ? _('Reviewing…') : _('Ask AI to review this question')}
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className='flex gap-2'>
          <button
            className='btn-primary flex-1 cursor-pointer rounded-xl px-4 py-3 font-semibold transition-colors'
            style={{ backgroundColor: accentColor, color: bgColor, border: 'none' }}
            onClick={onNext}
          >
            {isLast ? _('Results →') : _('Next →')}
          </button>
          {isLast && (
            <button
              className='eink-bordered flex-1 cursor-pointer rounded-xl border border-gray-500/30 bg-transparent px-4 py-3 font-medium transition-colors hover:bg-gray-500/10'
              style={{ color: fgColor }}
              onClick={onMore}
            >
              {_('More questions')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComprehensionFeedbackDialog;
