import React from 'react';
import { RiSpeedLine } from 'react-icons/ri';

import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import Button from '@/components/Button';

interface RSVPTogglerProps {
  bookKey: string;
}

const RSVPToggler: React.FC<RSVPTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const iconSize18 = useResponsiveSize(18);
  const bookData = getBookData(bookKey);

  const startRSVP = () => {
    eventDispatcher.dispatch('rsvp-start', { bookKey });
  };

  return (
    <Button
      icon={<RiSpeedLine className='text-base-content' size={iconSize18} />}
      onClick={startRSVP}
      disabled={bookData?.isFixedLayout}
      label={_('Speed Reading Mode')}
    ></Button>
  );
};

export default RSVPToggler;
