'use client';

import React, { useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { IoCheckmarkCircle, IoCloseCircle } from 'react-icons/io5';
import { MdBugReport } from 'react-icons/md';
import type { ComprehensionResult } from '@/services/comprehension';

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

interface ComprehensionResultsDialogProps {
  results: ComprehensionResult[];
  lastPrompt: string | null;
  onMore: () => void;
  onClose: () => void;
}

const ComprehensionResultsDialog: React.FC<ComprehensionResultsDialogProps> = ({
  results,
  lastPrompt,
  onMore,
  onClose,
}) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode } = useThemeStore();
  const bgColor = themeCode.palette['base-200'] || themeCode.bg;
  const fgColor = themeCode.fg;
  const accentColor = themeCode.primary;
  const backdropColor = isDarkMode ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';
  const correctColor = '#22c55e';
  const wrongColor = '#ef4444';

  const [showDebug, setShowDebug] = useState(false);

  const score = results.filter((r) => r.isCorrect).length;

  return (
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center'
      style={{ backgroundColor: backdropColor }}
      role='presentation'
    >
      <div
        className='mx-4 flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl shadow-2xl'
        style={{ backgroundColor: bgColor, color: fgColor }}
        role='dialog'
        aria-modal='true'
        aria-labelledby='comprehension-results-title'
      >
        {/* Header */}
        <div className='flex-none flex items-start justify-between px-6 pt-6'>
          <div>
            <h2 id='comprehension-results-title' className='mb-1 text-lg font-bold'>
              {_('Results')}
            </h2>
            <p className='text-3xl font-bold' style={{ color: accentColor }}>
              {score} / {results.length}
            </p>
          </div>
          {lastPrompt && (
            <button
              onClick={() => setShowDebug((v) => !v)}
              title='Debug: show AI prompt'
              className='mt-1 rounded-lg p-1.5 opacity-40 transition-opacity hover:opacity-80'
              style={{ color: fgColor }}
            >
              <MdBugReport size={20} />
            </button>
          )}
        </div>

        {/* Debug panel */}
        {showDebug && lastPrompt && (
          <div className='mx-6 mt-3 rounded-xl bg-gray-500/10 p-3'>
            <p className='mb-1 text-xs font-semibold opacity-60'>Prompt sent to AI:</p>
            <pre
              className='max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs opacity-70'
              style={{ fontFamily: 'monospace' }}
            >
              {lastPrompt}
            </pre>
          </div>
        )}

        {/* Scrollable results list */}
        <div className='flex-1 overflow-y-auto px-6 py-4'>
          <div className='flex flex-col gap-4'>
            {results.map((r, i) => (
              <div key={i} className='rounded-xl bg-gray-500/10 p-4'>
                <div className='mb-2 flex items-start gap-2'>
                  {r.isCorrect ? (
                    <IoCheckmarkCircle size={18} color={correctColor} className='mt-0.5 shrink-0' />
                  ) : (
                    <IoCloseCircle size={18} color={wrongColor} className='mt-0.5 shrink-0' />
                  )}
                  <p className='text-sm font-semibold leading-snug'>{r.question}</p>
                </div>
                <p className='mb-1 text-xs opacity-60'>
                  {_('Your answer: ')}
                  {OPTION_LABELS[r.chosen]}. {r.options[r.chosen]}
                </p>
                {!r.isCorrect && (
                  <p className='mb-1 text-xs' style={{ color: correctColor }}>
                    {_('Correct: ')}
                    {OPTION_LABELS[r.correct]}. {r.options[r.correct]}
                  </p>
                )}
                {r.explanation && <p className='mt-1 text-xs opacity-50 italic'>{r.explanation}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Footer buttons */}
        <div className='flex-none flex gap-2 px-6 pb-6 pt-2'>
          <button
            className='eink-bordered flex-1 cursor-pointer rounded-xl border border-gray-500/30 bg-transparent px-4 py-3 font-medium transition-colors hover:bg-gray-500/10'
            style={{ color: fgColor }}
            onClick={onMore}
          >
            {_('More questions')}
          </button>
          <button
            className='btn-primary flex-1 cursor-pointer rounded-xl px-4 py-3 font-semibold transition-colors'
            style={{ backgroundColor: accentColor, color: bgColor, border: 'none' }}
            onClick={onClose}
          >
            {_('Close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComprehensionResultsDialog;
