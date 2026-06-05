'use client';

import React from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { IoBulb } from 'react-icons/io5';

interface ComprehensionOfferDialogProps {
  onAccept: () => void;
  onDecline: () => void;
}

const ComprehensionOfferDialog: React.FC<ComprehensionOfferDialogProps> = ({
  onAccept,
  onDecline,
}) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode } = useThemeStore();
  const bgColor = themeCode.palette['base-200'] || themeCode.bg;
  const fgColor = themeCode.fg;
  const accentColor = themeCode.primary;
  const backdropColor = isDarkMode ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';

  return (
    <div
      role='presentation'
      className='fixed inset-0 z-[10001] flex items-center justify-center'
      style={{ backgroundColor: backdropColor }}
      onClick={onDecline}
      onKeyDown={(e) => e.key === 'Escape' && onDecline()}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className='mx-4 w-full max-w-sm rounded-2xl p-6 shadow-2xl'
        style={{ backgroundColor: bgColor, color: fgColor }}
        onClick={(e) => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
        aria-labelledby='comprehension-offer-title'
      >
        <div className='mb-4 flex items-center gap-3'>
          <div
            className='flex h-10 w-10 items-center justify-center rounded-full'
            style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
          >
            <IoBulb size={22} />
          </div>
          <h2 id='comprehension-offer-title' className='text-lg font-bold'>
            {_('Comprehension Check')}
          </h2>
        </div>
        <p className='mb-6 text-sm opacity-70'>
          {_('Would you like to take a short quiz based on what you just read?')}
        </p>
        <div className='flex flex-col gap-2'>
          <button
            className='btn-primary w-full cursor-pointer rounded-xl px-4 py-3 font-semibold transition-colors'
            style={{ backgroundColor: accentColor, color: bgColor, border: 'none' }}
            onClick={onAccept}
          >
            {_('Yes, test me')}
          </button>
          <button
            className='eink-bordered w-full cursor-pointer rounded-xl border border-gray-500/30 bg-transparent px-4 py-3 font-medium transition-colors hover:bg-gray-500/10'
            style={{ color: fgColor }}
            onClick={onDecline}
          >
            {_('No thanks')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComprehensionOfferDialog;
