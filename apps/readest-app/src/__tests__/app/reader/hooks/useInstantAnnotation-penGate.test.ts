import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Only getViewSettings matters for the enable gate; everything else is stubbed
// just enough for the hook to initialize.
const h = vi.hoisted(() => ({
  viewSettings: {} as Record<string, unknown>,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: vi.fn(), saveConfig: vi.fn(), updateBooknotes: vi.fn() }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getViewsById: () => [],
    getViewSettings: () => h.viewSettings,
    getProgress: () => null,
  }),
}));

import { useInstantAnnotation } from '@/app/reader/hooks/useInstantAnnotation';

const setup = () =>
  renderHook(() =>
    useInstantAnnotation({
      bookKey: 'book-1',
      getAnnotationText: vi.fn(async () => ''),
      setSelection: vi.fn(),
      setEditingAnnotation: vi.fn(),
      setExternalDragPoint: vi.fn(),
    }),
  );

beforeEach(() => {
  h.viewSettings = {};
});
afterEach(() => cleanup());

describe('useInstantAnnotation pen-defaults-to-highlight gate', () => {
  test('global highlight quick action enables every pointer type', () => {
    h.viewSettings = {
      enableAnnotationQuickActions: true,
      annotationQuickAction: 'highlight',
      penDefaultsToHighlight: false,
    };
    const { result } = setup();
    expect(result.current.isInstantAnnotationEnabled('mouse')).toBe(true);
    expect(result.current.isInstantAnnotationEnabled('touch')).toBe(true);
    expect(result.current.isInstantAnnotationEnabled('pen')).toBe(true);
  });

  test('penDefaultsToHighlight engages ONLY the pen (finger/mouse stay on normal selection)', () => {
    h.viewSettings = {
      enableAnnotationQuickActions: true,
      annotationQuickAction: null,
      penDefaultsToHighlight: true,
    };
    const { result } = setup();
    expect(result.current.isInstantAnnotationEnabled('pen')).toBe(true);
    expect(result.current.isInstantAnnotationEnabled('touch')).toBe(false);
    expect(result.current.isInstantAnnotationEnabled('mouse')).toBe(false);
    expect(result.current.isInstantAnnotationEnabled()).toBe(false);
  });

  test('neither setting on: nothing engages, including the pen', () => {
    h.viewSettings = {
      enableAnnotationQuickActions: true,
      annotationQuickAction: null,
      penDefaultsToHighlight: false,
    };
    const { result } = setup();
    expect(result.current.isInstantAnnotationEnabled('pen')).toBe(false);
    expect(result.current.isInstantAnnotationEnabled('touch')).toBe(false);
    expect(result.current.isInstantAnnotationEnabled('mouse')).toBe(false);
  });

  test('a non-highlight quick action does not enable; pen flag is independent', () => {
    h.viewSettings = {
      enableAnnotationQuickActions: true,
      annotationQuickAction: 'underline',
      penDefaultsToHighlight: false,
    };
    const { result } = setup();
    expect(result.current.isInstantAnnotationEnabled('pen')).toBe(false);
    expect(result.current.isInstantAnnotationEnabled('mouse')).toBe(false);
  });
});
