import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { RSVPController } from '@/services/rsvp/RSVPController';
import { FoliateView } from '@/types/view';

const POSITION_KEY = 'readest_rsvp_pos_test';

function makeTextNode(text: string): Text {
  return { nodeType: Node.TEXT_NODE, textContent: text } as unknown as Text;
}

function makeDoc(text: string): Document {
  const textNode = makeTextNode(text);
  const body = {
    nodeType: Node.ELEMENT_NODE,
    tagName: 'BODY',
    childNodes: [textNode],
    ownerDocument: null as unknown as Document,
  } as unknown as HTMLElement;

  const doc = {
    body,
    createRange: vi.fn().mockReturnValue({
      setStart: vi.fn(),
      setEnd: vi.fn(),
    }),
    defaultView: {
      getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
    },
  } as unknown as Document;

  (body as unknown as { ownerDocument: Document }).ownerDocument = doc;
  (textNode as unknown as { ownerDocument: Document }).ownerDocument = doc;
  return doc;
}

function createMockView(primaryIndex: number, docs: Document[]): FoliateView {
  return {
    renderer: {
      primaryIndex,
      getContents: vi.fn().mockReturnValue(docs.map((doc, i) => ({ doc, index: i }))),
    },
    book: { toc: [] },
    language: { isCJK: false },
    tts: null,
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/4!/4/2/1:0)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: vi.fn().mockReturnValue(new Range()) }),
  } as unknown as FoliateView;
}

/** Build a minimal Document with two chapters separated by anchor elements.
 *  Chapter A: words "alpha beta gamma"   (anchored on id="ch-a")
 *  Chapter B: words "delta epsilon zeta omega"  (anchored on id="ch-b")
 */
function makeMultiChapterDoc(): Document {
  const makeEl = (
    tag: string,
    id: string | null,
    text: string | null,
    doc: Document,
  ): HTMLElement => {
    const textNode = text
      ? ({ nodeType: Node.TEXT_NODE, textContent: text, ownerDocument: doc } as unknown as Text)
      : null;
    const el: HTMLElement = {
      nodeType: Node.ELEMENT_NODE,
      tagName: tag.toUpperCase(),
      id: id ?? '',
      childNodes: textNode ? [textNode] : [],
      ownerDocument: doc,
    } as unknown as HTMLElement;
    return el;
  };

  const doc = {
    createRange: vi.fn().mockReturnValue({ setStart: vi.fn(), setEnd: vi.fn() }),
    defaultView: {
      getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
    },
  } as unknown as Document;

  const anchorA = makeEl('div', 'ch-a', null, doc);
  const textA = makeEl('p', null, 'alpha beta gamma', doc);
  const anchorB = makeEl('div', 'ch-b', null, doc);
  const textB = makeEl('p', null, 'delta epsilon zeta omega', doc);

  const body: HTMLElement = {
    nodeType: Node.ELEMENT_NODE,
    tagName: 'BODY',
    id: '',
    childNodes: [anchorA, textA, anchorB, textB],
    ownerDocument: doc,
  } as unknown as HTMLElement;

  (doc as unknown as { body: HTMLElement }).body = body;
  return doc;
}

describe('RSVPController', () => {
  // start() schedules a countdown (setInterval) which then schedules the
  // recurring word-advance (setTimeout). These tests assert synchronously and
  // never stop the controller, so on the real clock those timers fire ~1.5s
  // later — after the test file's jsdom env has been torn down — and throw an
  // unhandled error from emitStateChange's dispatchEvent (a stale-realm
  // CustomEvent), failing the whole run intermittently on CI. Fake only the
  // timer functions so they can never fire on the real clock; useRealTimers in
  // afterEach discards any still-pending fakes. Date/performance stay real, so
  // the CFI/position assertions are unaffected.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    // jsdom's localStorage implementation is unavailable in this vitest version;
    // provide a minimal in-memory mock so RSVPController can persist settings.
    const store: Record<string, string> = {};
    const lsMock = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: lsMock, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start()', () => {
    test('extracts words from primary spine document only', () => {
      const ch1Doc = makeDoc('Hello world');
      const ch2Doc = makeDoc('Foo bar baz');
      const view = createMockView(0, [ch1Doc, ch2Doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      controller.start();

      // Should only have words from doc at primaryIndex 0
      expect(controller.currentState.words.length).toBe(2);
      expect(controller.currentState.words[0]!.text).toBe('Hello');
      expect(controller.currentState.words[1]!.text).toBe('world');
    });

    test('sets active state after start', () => {
      const doc = makeDoc('one two three');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      controller.start();

      expect(controller.currentState.active).toBe(true);
      expect(controller.currentState.currentIndex).toBe(0);
    });

    test('uses secondary doc when primaryIndex is 1', () => {
      const ch1Doc = makeDoc('Hello world');
      const ch2Doc = makeDoc('Foo bar');
      const view = createMockView(1, [ch1Doc, ch2Doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      controller.start();

      expect(controller.currentState.words.length).toBe(2);
      expect(controller.currentState.words[0]!.text).toBe('Foo');
    });
  });

  describe('currentDisplayWord', () => {
    test('returns full word when splitHyphens is false', () => {
      const doc = makeDoc('well-known');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setSplitHyphens(false);
      controller.start();

      expect(controller.currentDisplayWord?.text).toBe('well-known');
    });

    test('returns first part only when splitHyphens is true', () => {
      const doc = makeDoc('well-known');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setSplitHyphens(true);
      controller.start();

      expect(controller.currentDisplayWord?.text).toBe('well-');
    });

    test('returns unsplit word when splitHyphens is true but no hyphen pattern', () => {
      const doc = makeDoc('hello');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setSplitHyphens(true);
      controller.start();

      expect(controller.currentDisplayWord?.text).toBe('hello');
    });
  });

  describe('ORP calculation', () => {
    test('places ORP near the start of short Latin words', () => {
      const doc = makeDoc('Hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      // 5-letter words: ORP at index 1
      expect(words[0]!.orpIndex).toBe(1);
      expect(words[1]!.orpIndex).toBe(1);
    });

    test('places ORP based on letter count for Cyrillic words', () => {
      // "Привет" = 6 letters, "мир" = 3 letters
      const doc = makeDoc('Привет мир');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('Привет');
      // 6-letter word should have ORP at index 2 (same as Latin "Hellos")
      expect(words[0]!.orpIndex).toBe(2);
      expect(words[1]!.text).toBe('мир');
      // 3-letter word: ORP at index 0
      expect(words[1]!.orpIndex).toBe(0);
    });

    test('places ORP based on letter count for accented Latin words', () => {
      // "naïve" = 5 letters with combining/precomposed diacritic
      const doc = makeDoc('naïve');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('naïve');
      // Should be treated as a 5-letter word, ORP at index 1
      expect(words[0]!.orpIndex).toBe(1);
    });
  });

  describe('seedPosition', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    test('overwrites stale local position with cloud-synced position', () => {
      // Device B has a stale local entry from a previous session.
      const stale = { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'stale' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(stale));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      // Cloud-synced position arrives via BookConfig.rsvpPosition.
      const fresh = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'fresh' };
      controller.seedPosition(fresh);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(fresh);
    });

    test('writes provided position when localStorage is empty', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const position = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'fresh' };
      controller.seedPosition(position);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(position);
    });

    test('skips redundant write when value already matches', () => {
      const position = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'same' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(position));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      controller.seedPosition(position);

      const positionWrites = setItemSpy.mock.calls.filter(([key]) => key === POSITION_KEY);
      expect(positionWrites).toHaveLength(0);
      setItemSpy.mockRestore();
    });

    test('falls back to start of synced chapter when rsvpPosition is in a different chapter than location', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stalePosition = { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'stale' };
      const currentLocation = 'epubcfi(/6/8!/4/2/1:0)';

      controller.seedPosition(stalePosition, currentLocation);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual({
        cfi: 'epubcfi(/6/8)',
        wordText: '',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RSVP]'),
        expect.objectContaining({ rsvpCfi: stalePosition.cfi, locationCfi: currentLocation }),
      );
      warnSpy.mockRestore();
    });

    test('section-start fallback overwrites a stale local entry on chapter mismatch', () => {
      const stale = { cfi: 'epubcfi(/6/2!/4/2/1:0)', wordText: 'stale' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(stale));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      controller.seedPosition(
        { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'fresh' },
        'epubcfi(/6/8!/4/2/1:0)',
      );

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual({
        cfi: 'epubcfi(/6/8)',
        wordText: '',
      });
      warnSpy.mockRestore();
    });

    test('skips redundant write when section-start fallback already matches stored value', () => {
      const fallback = { cfi: 'epubcfi(/6/8)', wordText: '' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(fallback));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      controller.seedPosition(
        { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'fresh' },
        'epubcfi(/6/8!/4/2/1:0)',
      );

      const positionWrites = setItemSpy.mock.calls.filter(([key]) => key === POSITION_KEY);
      expect(positionWrites).toHaveLength(0);
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('seeds normally when rsvpPosition and location share a spine section', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const position = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'fresh' };
      const currentLocation = 'epubcfi(/6/8!/4/2/3:5)'; // same spine, different offset

      controller.seedPosition(position, currentLocation);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(position);
    });

    test('seeds normally when no current location is provided', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const position = { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'fresh' };
      controller.seedPosition(position);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(position);
    });
  });

  describe('em-dash and en-dash splitting', () => {
    test('splits compound word joined by em-dash into separate words', () => {
      const doc = makeDoc('best—of all possible—worlds');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words.map((w) => w.text);
      expect(words).toEqual(['best—', 'of', 'all', 'possible—', 'worlds']);
    });

    test('splits compound word joined by en-dash into separate words', () => {
      const doc = makeDoc('pages 10–15 covered');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words.map((w) => w.text);
      expect(words).toEqual(['pages', '10–', '15', 'covered']);
    });
  });

  describe('duplicate word blank insertion', () => {
    test('inserts blank between two consecutive identical words', () => {
      const doc = makeDoc('the the cat');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('the');
      expect(words[1]!.text).toBe(' ');
      expect(words[2]!.text).toBe('the');
      expect(words[3]!.text).toBe('cat');
    });

    test('does not insert blank between different words', () => {
      const doc = makeDoc('the cat');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words.length).toBe(2);
      expect(words[0]!.text).toBe('the');
      expect(words[1]!.text).toBe('cat');
    });
  });

  describe('getChapterWordsAt', () => {
    test('returns only words up to the given index, not the full chapter', () => {
      const doc = makeMultiChapterDoc();
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setToc([
        { id: 1, index: 0, label: 'Chapter A', href: 'file.xhtml#ch-a', subitems: [] },
        { id: 2, index: 1, label: 'Chapter B', href: 'file.xhtml#ch-b', subitems: [] },
      ]);
      controller.start();

      const words = controller.currentState.words;
      // Ch B starts at the first word tagged with ch-b href.
      const chBStart = words.findIndex((w) => w.chapterHref === 'file.xhtml#ch-b');
      expect(chBStart).toBeGreaterThan(0);

      // Simulate reading 2 words into Ch B (chBStart + 1).
      const midIndex = chBStart + 1;

      // getChapterWordsAt should return only words from ch-b start up to midIndex.
      const result = controller.getChapterWordsAt(midIndex);
      expect(result).toEqual(['delta', 'epsilon']);

      // Confirm it does NOT include words beyond midIndex ('zeta', 'omega').
      expect(result).not.toContain('zeta');
      expect(result).not.toContain('omega');
    });

    test('returns the full chapter when called at the last word of a chapter', () => {
      const doc = makeMultiChapterDoc();
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setToc([
        { id: 1, index: 0, label: 'Chapter A', href: 'file.xhtml#ch-a', subitems: [] },
        { id: 2, index: 1, label: 'Chapter B', href: 'file.xhtml#ch-b', subitems: [] },
      ]);
      controller.start();

      const words = controller.currentState.words;
      const lastChBIndex = words.length - 1; // 'omega' is the last word

      const result = controller.getChapterWordsAt(lastChBIndex);
      expect(result).toEqual(['delta', 'epsilon', 'zeta', 'omega']);
    });
  });

  describe('isNewBlock', () => {
    // Build a minimal Document with two <p> elements back-to-back.
    //   <body><p>hello world</p><p>foo bar</p></body>
    function makeBlockDoc(): Document {
      const doc = {
        createRange: vi.fn().mockReturnValue({ setStart: vi.fn(), setEnd: vi.fn() }),
        defaultView: {
          getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
        },
      } as unknown as Document;
      const makeEl = (
        tag: string,
        textContent: string | null,
        children?: unknown[],
      ): HTMLElement => {
        const textNode = textContent
          ? ({ nodeType: Node.TEXT_NODE, textContent, ownerDocument: doc } as unknown as Text)
          : null;
        return {
          nodeType: Node.ELEMENT_NODE,
          tagName: tag.toUpperCase(),
          id: '',
          childNodes: children ?? (textNode ? [textNode] : []),
          ownerDocument: doc,
        } as unknown as HTMLElement;
      };
      const p1 = makeEl('p', 'hello world');
      const p2 = makeEl('p', 'foo bar');
      const body = makeEl('body', null, [p1, p2]);
      (doc as unknown as { body: HTMLElement }).body = body;
      return doc;
    }

    // Build: <body><p>hello<br/>world</p></body>
    function makeBreakDoc(): Document {
      const doc = {
        createRange: vi.fn().mockReturnValue({ setStart: vi.fn(), setEnd: vi.fn() }),
        defaultView: {
          getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
        },
      } as unknown as Document;
      const makeText = (t: string) =>
        ({ nodeType: Node.TEXT_NODE, textContent: t, ownerDocument: doc }) as unknown as Text;
      const brEl = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'BR',
        id: '',
        childNodes: [],
        ownerDocument: doc,
      } as unknown as HTMLElement;
      const p = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'P',
        id: '',
        childNodes: [makeText('hello'), brEl, makeText('world')],
        ownerDocument: doc,
      } as unknown as HTMLElement;
      const body = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'BODY',
        id: '',
        childNodes: [p],
        ownerDocument: doc,
      } as unknown as HTMLElement;
      (doc as unknown as { body: HTMLElement }).body = body;
      return doc;
    }

    // Build: <body><p>hello <em>world</em> bye</p></body>
    function makeInlineDoc(): Document {
      const doc = {
        createRange: vi.fn().mockReturnValue({ setStart: vi.fn(), setEnd: vi.fn() }),
        defaultView: {
          getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
        },
      } as unknown as Document;
      const makeText = (t: string) =>
        ({ nodeType: Node.TEXT_NODE, textContent: t, ownerDocument: doc }) as unknown as Text;
      const em = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'EM',
        id: '',
        childNodes: [makeText('world')],
        ownerDocument: doc,
      } as unknown as HTMLElement;
      const p = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'P',
        id: '',
        childNodes: [makeText('hello '), em, makeText(' bye')],
        ownerDocument: doc,
      } as unknown as HTMLElement;
      const body = {
        nodeType: Node.ELEMENT_NODE,
        tagName: 'BODY',
        id: '',
        childNodes: [p],
        ownerDocument: doc,
      } as unknown as HTMLElement;
      (doc as unknown as { body: HTMLElement }).body = body;
      return doc;
    }

    test('first word overall does not get isNewBlock (no previous words)', () => {
      const view = createMockView(0, [makeBlockDoc()]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('hello');
      expect(words[0]!.isNewBlock).toBeFalsy();
    });

    test('first word of second paragraph gets isNewBlock true', () => {
      const view = createMockView(0, [makeBlockDoc()]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      const fooIdx = words.findIndex((w) => w.text === 'foo');
      expect(fooIdx).toBeGreaterThan(0);
      expect(words[fooIdx]!.isNewBlock).toBe(true);
    });

    test('word after <br> gets isNewBlock true', () => {
      const view = createMockView(0, [makeBreakDoc()]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('hello');
      expect(words[0]!.isNewBlock).toBeFalsy();
      const worldIdx = words.findIndex((w) => w.text === 'world');
      expect(worldIdx).toBeGreaterThan(0);
      expect(words[worldIdx]!.isNewBlock).toBe(true);
    });

    test('inline element (em) does not trigger isNewBlock', () => {
      const view = createMockView(0, [makeInlineDoc()]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      // words: hello, world, bye  — none should have isNewBlock
      // 'world' is inside <em> but <em> is inline
      const worldIdx = words.findIndex((w) => w.text === 'world');
      expect(worldIdx).toBeGreaterThan(0);
      expect(words[worldIdx]!.isNewBlock).toBeFalsy();
      const byeIdx = words.findIndex((w) => w.text === 'bye');
      expect(byeIdx).toBeGreaterThan(0);
      expect(words[byeIdx]!.isNewBlock).toBeFalsy();
    });
  });

  describe('CJK character mode', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    test('cjkCharMode defaults to false and hasCJK is false for Latin text', () => {
      const view = createMockView(0, [makeDoc('Hello world')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.cjkCharMode).toBe(false);
      expect(controller.currentState.hasCJK).toBe(false);
    });

    test('hasCJK is true when the section contains CJK text', () => {
      const view = createMockView(0, [makeDoc('你好世界')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.hasCJK).toBe(true);
    });

    test('setCjkCharMode(true) re-segments the active section per-character', () => {
      const view = createMockView(0, [makeDoc('我喜欢阅读')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();
      controller.setCjkCharMode(true);

      expect(controller.currentState.words.map((w) => w.text)).toEqual([
        '我',
        '喜',
        '欢',
        '阅',
        '读',
      ]);
    });

    test('setCjkCharMode persists the choice to localStorage', () => {
      const view = createMockView(0, [makeDoc('你好')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setCjkCharMode(true);

      expect(localStorage.getItem('readest_rsvp_cjk_char_mode')).toBe('1');
    });

    test('keeps the focus character off trailing punctuation in char mode', () => {
      const view = createMockView(0, [makeDoc('是。')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setCjkCharMode(true);
      controller.start();

      const word = controller.currentState.words[0]!;
      expect(word.text).toBe('是。');
      // The focus must land on 是 (index 0), not the trailing 。
      expect(word.orpIndex).toBe(0);
    });

    test('char mode is restored from localStorage on construction', () => {
      localStorage.setItem('readest_rsvp_cjk_char_mode', '1');
      const view = createMockView(0, [makeDoc('我喜欢阅读')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.cjkCharMode).toBe(true);
      expect(controller.currentState.words.map((w) => w.text)).toEqual([
        '我',
        '喜',
        '欢',
        '阅',
        '读',
      ]);
    });
  });
});
