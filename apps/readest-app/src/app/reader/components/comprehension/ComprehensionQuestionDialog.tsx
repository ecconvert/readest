'use client';

import React from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { ComprehensionQuestion } from '@/services/comprehension';

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

interface ComprehensionQuestionDialogProps {
  question: ComprehensionQuestion;
  index: number;
  total: number;
  onAnswer: (chosenIndex: number) => void;
}

const ComprehensionQuestionDialog: React.FC<ComprehensionQuestionDialogProps> = ({
  question,
  index,
  total,
  onAnswer,
}) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode } = useThemeStore();
  const bgColor = themeCode.palette['base-200'] || themeCode.bg;
  const fgColor = themeCode.fg;
  const accentColor = themeCode.primary;
  const backdropColor = isDarkMode ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';

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
        aria-label={_('Comprehension question')}
      >
        <p className='mb-3 text-xs font-semibold uppercase tracking-wider opacity-50'>
          {_('Question {{index}} of {{total}}', { index: index + 1, total })}
        </p>
        <p className='mb-5 text-base font-semibold leading-snug'>{question.question}</p>
        <div className='flex flex-col gap-2'>
          {question.options.map((option, i) => (
            <button
              key={i}
              className='flex cursor-pointer items-center gap-3 rounded-xl border-none bg-gray-500/10 px-4 py-3 text-left transition-colors hover:bg-gray-500/20'
              style={{ color: fgColor }}
              onClick={() => onAnswer(i)}
            >
              <span
                className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold'
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                {OPTION_LABELS[i]}
              </span>
              <span className='text-sm'>{option}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ComprehensionQuestionDialog;
