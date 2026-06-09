import React from 'react';
import { MdOutlineQuiz } from 'react-icons/md';

import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import Button from '@/components/Button';

interface ComprehensionTogglerProps {
  bookKey: string;
}

const ComprehensionToggler: React.FC<ComprehensionTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const iconSize18 = useResponsiveSize(18);
  const bookData = getBookData(bookKey);

  const startComprehension = () => {
    eventDispatcher.dispatch('comprehension-start', { bookKey });
  };

  return (
    <Button
      icon={<MdOutlineQuiz className='text-base-content' size={iconSize18} />}
      onClick={startComprehension}
      disabled={bookData?.isFixedLayout}
      label={_('Comprehension Quiz')}
    />
  );
};

export default ComprehensionToggler;
