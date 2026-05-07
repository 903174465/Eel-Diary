import React, { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ChevronLeft, ChevronRight, LayoutGrid, Mic, Square, Trash2, Upload, X } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import localforage from 'localforage';

gsap.registerPlugin(ScrollTrigger);

type NoteMediaKind = 'audio' | 'video' | 'image';

type MemoryNoteMedia = {
  id: string;
  kind: NoteMediaKind;
  url: string;
  label: string;
  mimeType?: string;
};

type MemoryTimeInfo = {
  year: string;
  month: string;
  day: string;
  period: string;
  custom: string;
};

type Memory = {
  id: string;
  url: string;
  type?: 'image' | 'video';
  title: string;
  date: string;
  note: string;
  noteMedia?: MemoryNoteMedia[];
  timeInfo?: MemoryTimeInfo;
};

type NoteSegment =
  | { type: 'text'; value: string }
  | { type: 'media'; mediaId: string };

type MediaPreviewState = {
  memoryId: string;
  mediaId: string;
};

const HIDE_TIME_VALUE = '__hide__';
const YEAR_OPTIONS = Array.from({ length: 46 }, (_, index) => String(1990 + index));
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
const PERIOD_OPTIONS = ['凌晨', '清晨', '上午', '中午', '下午', '夜晚'];
const EMPTY_TIME_INFO: MemoryTimeInfo = {
  year: '',
  month: '',
  day: '',
  period: '',
  custom: '',
};

const DEFAULT_MEMORIES: Memory[] = [
  {
    id: '1',
    url: 'https://images.unsplash.com/photo-1544413660-299165566b1d?q=80&w=2000&auto=format&fit=crop',
    type: 'image',
    title: '富士山之时',
    date: '2025-10-15',
    note: '飞机穿过厚厚的云层，白雪皑皑的山顶突然闯入眼帘。在这三万英尺的高空，时间仿佛静止。',
    noteMedia: [],
  },
  {
    id: '2',
    url: 'https://images.unsplash.com/photo-1499346123910-cfa68aab6985?q=80&w=2000&auto=format&fit=crop',
    type: 'image',
    title: '云端之上',
    date: '2026-01-02',
    note: '向下的视线被无尽的洁白填满。没有地界，只有漫无边际的云海，温柔地托起整个世界。',
    noteMedia: [],
  },
  {
    id: '3',
    url: 'https://images.unsplash.com/photo-1506140510129-cb6a5c10ea6e?q=80&w=2000&auto=format&fit=crop',
    type: 'image',
    title: '日落时刻',
    date: '2026-04-20',
    note: '夕阳的余晖将天空染成热烈的色彩，即使在这喧杂的世界里，这也是一刻难得的安静。',
    noteMedia: [],
  },
];

const MEDIA_TOKEN_PATTERN = /\[\[media:([^\]]+)\]\]/g;
const MEDIA_CHIP_CLASS =
  'inline-flex max-w-full items-center gap-2 overflow-hidden rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[10px] font-sans uppercase tracking-[0.24em] text-white/80 transition-colors hover:border-white/30 hover:bg-white/12 hover:text-white';

const buildMediaToken = (mediaId: string) => `[[media:${mediaId}]]`;

const isHiddenTimeValue = (value: string) => value === HIDE_TIME_VALUE;

const parseDateParts = (date: string) => {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { ...EMPTY_TIME_INFO };
  }

  return {
    ...EMPTY_TIME_INFO,
    year: match[1],
    month: match[2],
    day: match[3],
  };
};

const normalizeTimeInfo = (timeInfo: MemoryTimeInfo | undefined, date: string): MemoryTimeInfo => {
  const fallback = parseDateParts(date);
  return {
    year: timeInfo?.year ?? fallback.year,
    month: timeInfo?.month ?? fallback.month,
    day: timeInfo?.day ?? fallback.day,
    period: timeInfo?.period ?? '',
    custom: timeInfo?.custom ?? '',
  };
};

const applyTimeCascade = (timeInfo: MemoryTimeInfo): MemoryTimeInfo => {
  const next = { ...timeInfo };

  if (isHiddenTimeValue(next.year)) {
    next.month = HIDE_TIME_VALUE;
    next.day = HIDE_TIME_VALUE;
    next.period = HIDE_TIME_VALUE;
    return next;
  }

  if (isHiddenTimeValue(next.month)) {
    next.day = HIDE_TIME_VALUE;
    next.period = HIDE_TIME_VALUE;
    return next;
  }

  if (isHiddenTimeValue(next.day)) {
    next.period = HIDE_TIME_VALUE;
  }

  return next;
};

const buildIsoDateFromTimeInfo = (timeInfo: MemoryTimeInfo, fallbackDate: string) => {
  if (timeInfo.year && timeInfo.month && timeInfo.day) {
    return `${timeInfo.year}-${timeInfo.month}-${timeInfo.day}`;
  }

  return fallbackDate;
};

const formatMemoryDisplayTime = (memory: Memory) => {
  const timeInfo = normalizeTimeInfo(memory.timeInfo, memory.date);
  const custom = timeInfo.custom.trim();
  if (custom) {
    return custom;
  }

  const dateParts = [timeInfo.year, timeInfo.month, timeInfo.day].filter(Boolean);
  const formattedDate =
    dateParts.length === 3
      ? `${Number(timeInfo.year)}年${Number(timeInfo.month)}月${Number(timeInfo.day)}日`
      : memory.date;

  return [formattedDate, timeInfo.period].filter(Boolean).join(' ');
};

const normalizeMemory = (memory: Memory): Memory => ({
  ...memory,
  noteMedia: Array.isArray(memory.noteMedia) ? memory.noteMedia : [],
  timeInfo: applyTimeCascade(normalizeTimeInfo(memory.timeInfo, memory.date)),
});

const buildDateForSavedTimeInfo = (timeInfo: MemoryTimeInfo, fallbackDate: string) => {
  const normalized = applyTimeCascade({ ...timeInfo, custom: timeInfo.custom.trim() });
  if (
    normalized.year &&
    normalized.month &&
    normalized.day &&
    !isHiddenTimeValue(normalized.year) &&
    !isHiddenTimeValue(normalized.month) &&
    !isHiddenTimeValue(normalized.day)
  ) {
    return `${normalized.year}-${normalized.month}-${normalized.day}`;
  }

  return fallbackDate;
};

const getMemoryDisplayTimeLabel = (memory: Memory) => {
  const timeInfo = applyTimeCascade(normalizeTimeInfo(memory.timeInfo, memory.date));
  const custom = timeInfo.custom.trim();
  if (custom) {
    return custom;
  }

  const parts: string[] = [];
  if (timeInfo.year && !isHiddenTimeValue(timeInfo.year)) {
    parts.push(`${Number(timeInfo.year)}年`);
  }
  if (timeInfo.month && !isHiddenTimeValue(timeInfo.month)) {
    parts.push(`${Number(timeInfo.month)}月`);
  }
  if (timeInfo.day && !isHiddenTimeValue(timeInfo.day)) {
    parts.push(`${Number(timeInfo.day)}日`);
  }

  const dateLabel = parts.join('');
  const periodLabel =
    timeInfo.period && !isHiddenTimeValue(timeInfo.period) ? timeInfo.period : '';

  return [dateLabel, periodLabel].filter(Boolean).join(' ').trim();
};

const parseNoteSegments = (note: string): NoteSegment[] => {
  const segments: NoteSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MEDIA_TOKEN_PATTERN.lastIndex = 0;
  while ((match = MEDIA_TOKEN_PATTERN.exec(note)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: note.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'media', mediaId: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < note.length) {
    segments.push({ type: 'text', value: note.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: '' });
  }

  return segments;
};

const getMediaChipLabel = (media: MemoryNoteMedia) => {
  if (media.kind === 'video') return `VIDEO · ${media.label}`;
  if (media.kind === 'image') return `PHOTO · ${media.label}`;
  return `AUDIO · ${media.label}`;
};

const getClosestMediaElement = (node: Node | null): HTMLElement | null => {
  if (!node) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>('[data-media-id]') ?? null;
};

const isUsableInsertionRange = (editor: HTMLElement, range: Range) =>
  editor.contains(range.startContainer) &&
  editor.contains(range.endContainer) &&
  !getClosestMediaElement(range.startContainer) &&
  !getClosestMediaElement(range.endContainer);

const renderPlainTextWithBreaks = (text: string, keyPrefix: string) => {
  const lines = text.split('\n');
  return lines.map((line, index) => (
    <React.Fragment key={`${keyPrefix}-${index}`}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </React.Fragment>
  ));
};

const serializeNoteNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (!(node instanceof HTMLElement)) {
    return '';
  }

  if (node.dataset.mediaId) {
    return buildMediaToken(node.dataset.mediaId);
  }

  if (node.tagName === 'BR') {
    return '\n';
  }

  const childContent = Array.from(node.childNodes).map(serializeNoteNode).join('');
  if (node.tagName === 'DIV' || node.tagName === 'P') {
    return `${childContent}${childContent.endsWith('\n') ? '' : '\n'}`;
  }

  return childContent;
};

const serializeEditorContent = (root: HTMLElement) =>
  Array.from(root.childNodes)
    .map(serializeNoteNode)
    .join('')
    .replace(/\u00A0/g, ' ')
    .replace(/\n$/, '');

const appendTextNodes = (parent: Node, text: string) => {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    parent.appendChild(document.createTextNode(line));
    if (index < lines.length - 1) {
      parent.appendChild(document.createElement('br'));
    }
  });
};

const fillEditorMediaNode = (chip: HTMLSpanElement, media: MemoryNoteMedia) => {
  chip.innerHTML = '';
  if (media.kind === 'image') {
    const thumbnail = document.createElement('img');
    thumbnail.src = media.url;
    thumbnail.alt = media.label;
    thumbnail.className = 'h-6 w-6 shrink-0 rounded-[10px] object-cover';
    thumbnail.draggable = false;
    chip.appendChild(thumbnail);
  }

  const label = document.createElement('span');
  label.className = 'truncate';
  label.textContent = getMediaChipLabel(media);
  chip.appendChild(label);
};

const createEditorMediaNode = (media: MemoryNoteMedia) => {
  const chip = document.createElement('span');
  chip.dataset.mediaId = media.id;
  chip.dataset.mediaKind = media.kind;
  chip.contentEditable = 'false';
  chip.className = `${MEDIA_CHIP_CLASS} cursor-pointer`;
  fillEditorMediaNode(chip, media);
  return chip;
};

const buildEditorFragment = (note: string, mediaList: MemoryNoteMedia[]) => {
  const fragment = document.createDocumentFragment();
  const mediaMap = new Map(mediaList.map((media) => [media.id, media]));

  parseNoteSegments(note).forEach((segment) => {
    if (segment.type === 'text') {
      appendTextNodes(fragment, segment.value);
      return;
    }

    const media = mediaMap.get(segment.mediaId);
    if (media) {
      fragment.appendChild(createEditorMediaNode(media));
    }
  });

  return fragment;
};

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read media file.'));
    reader.readAsDataURL(blob);
  });

const createEmptyRangeAtEnd = (editor: HTMLElement) => {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
};

const NoteContent = ({
  note,
  media,
  onMediaClick,
  className = '',
}: {
  note: string;
  media: MemoryNoteMedia[];
  onMediaClick: (media: MemoryNoteMedia) => void;
  className?: string;
}) => {
  const mediaMap = new Map(media.map((item) => [item.id, item]));

  return (
    <div className={className}>
      {parseNoteSegments(note).map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <React.Fragment key={`text-${index}`}>
              {renderPlainTextWithBreaks(segment.value, `text-${index}`)}
            </React.Fragment>
          );
        }

        const target = mediaMap.get(segment.mediaId);
        if (!target) {
          return null;
        }

        return (
          <button
            key={`media-${target.id}-${index}`}
            type="button"
            className={`${MEDIA_CHIP_CLASS} mx-1 my-1 align-middle`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMediaClick(target);
            }}
          >
            {target.kind === 'image' ? (
              <img
                src={target.url}
                alt={target.label}
                className="h-6 w-6 shrink-0 rounded-[10px] object-cover"
              />
            ) : null}
            <span className="truncate">{getMediaChipLabel(target)}</span>
          </button>
        );
      })}
    </div>
  );
};

const NoteEditor = ({
  note,
  media,
  editorRef,
  onChange,
  onMediaClick,
  onSelectionChange,
}: {
  note: string;
  media: MemoryNoteMedia[];
  editorRef: React.RefObject<HTMLDivElement | null>;
  onChange: (nextValue: string) => void;
  onMediaClick: (media: MemoryNoteMedia) => void;
  onSelectionChange: () => void;
}) => {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const nextMediaSignature = media.map((item) => `${item.id}:${item.label}`).join('|');
    const currentMediaSignature = editor.dataset.mediaSignature ?? '';
    const currentValue = serializeEditorContent(editor);

    if (currentValue === note) {
      if (currentMediaSignature === nextMediaSignature) {
        return;
      }

      const mediaMap = new Map(media.map((item) => [item.id, item]));
      editor.querySelectorAll<HTMLSpanElement>('[data-media-id]').forEach((chip) => {
        const mediaId = chip.dataset.mediaId;
        if (!mediaId) return;
        const matchedMedia = mediaMap.get(mediaId);
        if (!matchedMedia) return;
        fillEditorMediaNode(chip, matchedMedia);
      });

      editor.dataset.mediaSignature = nextMediaSignature;
      return;
    }

    editor.innerHTML = '';
    editor.appendChild(buildEditorFragment(note, media));
    editor.dataset.mediaSignature = nextMediaSignature;
  }, [note, media, editorRef]);

  return (
    <div className="relative mt-4 flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
      {!note && (
        <div className="pointer-events-none absolute inset-0 text-base text-white/25">
          写下此时的感受...
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="h-full w-full overflow-y-auto bg-transparent pb-2 font-sans text-base leading-relaxed text-white/80 outline-none whitespace-pre-wrap break-words"
        onInput={(e) => {
          onChange(serializeEditorContent(e.currentTarget));
          onSelectionChange();
        }}
        onMouseDown={(e) => {
          const target = (e.target as HTMLElement).closest<HTMLElement>('[data-media-id]');
          if (!target) return;

          const matchedMedia = media.find((item) => item.id === target.dataset.mediaId);
          if (matchedMedia) {
            e.preventDefault();
            e.stopPropagation();
            onMediaClick(matchedMedia);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseUp={onSelectionChange}
        onKeyUp={onSelectionChange}
      />
    </div>
  );
};

const StackedCard = ({
  m,
  idx,
  total,
  progress,
  rawProgress,
  currentIndex,
  setCurrentIndex,
  setDirection,
  setIsArchiveOpen,
  isArchiveOpen,
  editingId,
  editTitle,
  setEditTitle,
  editNote,
  setEditNote,
  editNoteMedia,
  editTimeInfo,
  updateEditTimeInfo,
  openCustomTimeInput,
  handleEdit,
  handleDelete,
  submitEdit,
  cancelEdit,
  noteEditorRef,
  prepareMediaInsertion,
  syncDraftInsertAnchor,
  openNoteMediaPicker,
  toggleAudioRecording,
  isRecordingAudio,
  editorStatus,
  openMediaPreview,
}: any) => {
  const stackPos = useTransform(progress, (v: number) => {
    if (total <= 1) return 0;
    return idx - v * (total - 1);
  });

  const x = useTransform(stackPos, [-2, -1, 0, 1, 2, 3], ['-160%', '-120%', '0%', '10%', '20%', '30%']);
  const y = useTransform(stackPos, [-2, -1, 0, 1, 2, 3], ['0%', '0%', '0%', '2%', '4%', '6%']);
  const rotateZ = useTransform(stackPos, [-1, 0, 1, 2, 3], [-4, 0, 2, 4, 6]);
  const scale = useTransform(stackPos, [-1, 0, 1, 2, 3], [1, 1, 0.96, 0.92, 0.88]);
  const opacity = useTransform(stackPos, [-1, -0.5, 0, 1, 2, 3], [0, 0, 1, 1, 1, 1]);

  const isEditing = editingId === m.id;

  return (
    <motion.div
      style={{
        x,
        y,
        rotateZ,
        scale,
        opacity,
        zIndex: total - idx,
        transformOrigin: 'bottom right',
      }}
      className={`absolute inset-0 m-auto flex h-[85vh] max-h-[850px] w-[90vw] max-w-[510px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0A0B0D] shadow-[0_0_50px_rgba(0,0,0,0.8)] transition-colors duration-500 group ${
        currentIndex === idx && !isArchiveOpen ? 'ring-1 ring-white/50 ring-offset-8 ring-offset-[#050507]' : ''
      }`}
    >
      <div
        className="relative w-full flex-1 shrink-0 cursor-pointer overflow-hidden bg-[#121316]"
        onClick={(e) => {
          const currentStackPos = stackPos.get();
          const currentOpacity = opacity.get();

          if (currentOpacity < 0.6) {
            e.stopPropagation();
            return;
          }

          if (currentStackPos > 0.5) {
            e.stopPropagation();
            if (editingId && !submitEdit(editingId)) {
              return;
            }
            if (rawProgress) {
              rawProgress.set(idx / Math.max(1, total - 1));
            }
            return;
          }

          if (!isEditing) {
            handleEdit(m.id, m.title, m.note, m.noteMedia, m.timeInfo, e);
          }
        }}
      >
        {m.type === 'video' ? (
          <video
            src={m.url}
            className="h-full w-full object-cover opacity-80 transition-[opacity,transform] duration-700 group-hover:scale-[1.03] group-hover:opacity-100"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <img
            src={m.url}
            alt={m.title}
            className="h-full w-full object-cover opacity-80 transition-[transform,opacity] duration-700 group-hover:scale-[1.03] group-hover:opacity-100"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0A0B0D]/80 to-transparent" />

        <AnimatePresence>
          {isEditing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex cursor-default flex-col bg-[#0A0B0D]/95 p-6 backdrop-blur-xl"
              onClick={(e) => {
                e.stopPropagation();
                submitEdit(m.id, e as any);
              }}
            >
              <div className="flex flex-1 min-h-0 flex-col pt-6">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full border-b border-white/20 bg-transparent pb-2 font-serif text-2xl italic text-white outline-none focus:border-white/60"
                  placeholder="Title..."
                  autoFocus
                />
                <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <select
                    value={editTimeInfo.year}
                    onChange={(e) => updateEditTimeInfo('year', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-full border border-white/12 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/30"
                  >
                    <option value="" className="bg-[#0A0B0D] text-white">年份</option>
                    <option value={HIDE_TIME_VALUE} className="bg-[#0A0B0D] text-white">不显示</option>
                    {YEAR_OPTIONS.map((year) => (
                      <option key={year} value={year} className="bg-[#0A0B0D] text-white">
                        {year}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editTimeInfo.month}
                    onChange={(e) => updateEditTimeInfo('month', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={isHiddenTimeValue(editTimeInfo.year)}
                    className="rounded-full border border-white/12 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <option value="" className="bg-[#0A0B0D] text-white">月份</option>
                    <option value={HIDE_TIME_VALUE} className="bg-[#0A0B0D] text-white">不显示</option>
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month} value={month} className="bg-[#0A0B0D] text-white">
                        {Number(month)}月
                      </option>
                    ))}
                  </select>
                  <select
                    value={editTimeInfo.day}
                    onChange={(e) => updateEditTimeInfo('day', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={isHiddenTimeValue(editTimeInfo.year) || isHiddenTimeValue(editTimeInfo.month)}
                    className="rounded-full border border-white/12 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <option value="" className="bg-[#0A0B0D] text-white">日期</option>
                    <option value={HIDE_TIME_VALUE} className="bg-[#0A0B0D] text-white">不显示</option>
                    {DAY_OPTIONS.map((day) => (
                      <option key={day} value={day} className="bg-[#0A0B0D] text-white">
                        {Number(day)}日
                      </option>
                    ))}
                  </select>
                  <select
                    value={editTimeInfo.period}
                    onChange={(e) => updateEditTimeInfo('period', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={
                      isHiddenTimeValue(editTimeInfo.year) ||
                      isHiddenTimeValue(editTimeInfo.month) ||
                      isHiddenTimeValue(editTimeInfo.day)
                    }
                    className="rounded-full border border-white/12 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <option value="" className="bg-[#0A0B0D] text-white">时段</option>
                    <option value={HIDE_TIME_VALUE} className="bg-[#0A0B0D] text-white">不显示</option>
                    {PERIOD_OPTIONS.map((period) => (
                      <option key={period} value={period} className="bg-[#0A0B0D] text-white">
                        {period}
                      </option>
                    ))}
                  </select>
                  <div className="relative col-span-2 sm:col-span-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={openCustomTimeInput}
                      className="inline-flex h-[42px] w-full items-center justify-center rounded-full border border-white/12 bg-white/5 px-4 text-sm text-white transition-colors hover:border-white/30"
                    >
                      <span className="truncate">{editTimeInfo.custom.trim() || '自定义'}</span>
                    </button>
                  </div>
                </div>
                <NoteEditor
                  note={editNote}
                  media={editNoteMedia}
                  editorRef={noteEditorRef}
                  onChange={setEditNote}
                  onMediaClick={(media) => openMediaPreview(m.id, media)}
                  onSelectionChange={syncDraftInsertAnchor}
                />
              </div>
              <div className="relative mt-4 shrink-0 border-t border-white/10">
                <div className="pointer-events-none absolute left-1/2 top-1 min-h-[18px] -translate-x-1/2 text-center text-[10px] uppercase tracking-[0.3em] text-white/35">
                  {editorStatus}
                </div>
                <div className="flex min-h-[48px] translate-y-[12px] items-center justify-evenly gap-3">
                  <button
                    type="button"
                    onMouseDown={(e) => prepareMediaInsertion(e)}
                    onClick={openNoteMediaPicker}
                    className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 text-[9px] uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/35 hover:text-white"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    插入图片或音/视频
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      if (!isRecordingAudio) {
                        prepareMediaInsertion(e);
                      }
                    }}
                    onClick={toggleAudioRecording}
                    className={`inline-flex h-[38px] items-center justify-center gap-1.5 rounded-full border px-4 text-[9px] uppercase tracking-[0.18em] transition-colors ${
                      isRecordingAudio
                        ? 'border-red-400/50 text-red-200 hover:border-red-300 hover:text-white'
                        : 'border-white/15 text-white/70 hover:border-white/35 hover:text-white'
                    }`}
                  >
                    {isRecordingAudio ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {isRecordingAudio ? '结束' : '说话'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelEdit();
                    }}
                    className="inline-flex h-[38px] items-center justify-center rounded-full bg-white/10 px-5 text-[11px] uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/20"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-10 flex h-[72px] shrink-0 items-center justify-between border-t border-white/5 bg-[#0A0B0D] px-6">
        <h3 className="max-w-[70%] truncate text-base font-light italic tracking-wide text-white">
          {m.title || 'Untitled Memory'}
        </h3>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDirection(idx > currentIndex ? 1 : -1);
              setCurrentIndex(idx);
              setIsArchiveOpen(false);
            }}
            className="p-2 text-xs uppercase tracking-widest text-white/40 transition-colors hover:text-white"
            title="Go to memory"
          >
            VIEW
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(m.id, e);
            }}
            className="-mr-2 px-2 py-2 text-white/30 transition-colors hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

const HorizontalArchive = ({ memories, archiveScrollRef, editingId, ...props }: any) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const rawProgress = useMotionValue(0);

  const smoothProgress = useSpring(rawProgress, {
    damping: 30,
    stiffness: 120,
    mass: 0.8,
  });

  const totalCards = memories.length;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const maxScroll = Math.max(1, totalCards - 1) * 600;

    const handleWheel = (e: WheelEvent) => {
      if (totalCards <= 1 || editingId) return;

      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const current = rawProgress.get();
      let next = current + delta / maxScroll;

      const limits = { min: 0, max: 1 };
      if ((delta < 0 && current > limits.min) || (delta > 0 && current < limits.max)) {
        e.preventDefault();
        e.stopPropagation();
        next = Math.max(limits.min, Math.min(limits.max, next));
        rawProgress.set(next);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [editingId, rawProgress, totalCards]);

  return (
    <div className="relative -ml-[5vw] flex w-full items-center justify-center py-[10vh] lg:-ml-16">
      <div
        ref={containerRef}
        className="relative h-[85vh] max-h-[850px] w-[90vw] max-w-[510px]"
        style={{ perspective: '1500px', transformStyle: 'preserve-3d' }}
      >
        {memories.map((m: Memory, idx: number) => (
          <StackedCard
            key={m.id}
            m={m}
            idx={idx}
            total={totalCards}
            progress={smoothProgress}
            rawProgress={rawProgress}
            editingId={editingId}
            {...props}
          />
        ))}
      </div>
    </div>
  );
};

const SceneryLayer = ({ memory, idx, progress, total }: any) => {
  const getDistance = (v: number) => {
    if (total <= 1) return idx - v;
    let diff = (idx - v) % total;
    if (diff > total / 2) diff -= total;
    if (diff <= -total / 2) diff += total;
    return diff;
  };

  const distance = useTransform(progress, getDistance);
  const x = useTransform(distance, (d: number) => `${d * 100}%`);
  const opacity = useTransform(distance, [-1, 0, 1], [0.5, 1, 0.5]);
  const scale = useTransform(distance, [-1, 0, 1], [0.95, 1, 1.05]);
  const display = useTransform(distance, (d: number) => (Math.abs(d) > 1.5 ? 'none' : 'flex'));

  return (
    <motion.div
      style={{ x, opacity, scale, display }}
      className="absolute inset-0 h-full w-full items-center justify-center will-change-transform"
    >
      {memory.type === 'video' ? (
        <>
          <video
            src={memory.url}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 blur-3xl"
            autoPlay
            muted
            loop
            playsInline
          />
          <video
            src={memory.url}
            className="pointer-events-none relative z-10 h-full w-full object-contain"
            autoPlay
            muted
            loop
            playsInline
          />
        </>
      ) : (
        <>
          <img src={memory.url} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40 blur-3xl" />
          <img src={memory.url} alt="" className="pointer-events-none relative z-10 h-full w-full object-contain" />
        </>
      )}
    </motion.div>
  );
};

export default function App() {
  const [memories, setMemories] = useState<Memory[]>(() => DEFAULT_MEMORIES.map(normalizeMemory));
  const [virtualIndex, setVirtualIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editNoteMedia, setEditNoteMedia] = useState<MemoryNoteMedia[]>([]);
  const [editTimeInfo, setEditTimeInfo] = useState<MemoryTimeInfo>(EMPTY_TIME_INFO);
  const [isCustomTimeInputOpen, setIsCustomTimeInputOpen] = useState(false);
  const [customTimeDraft, setCustomTimeDraft] = useState('');
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [editorStatus, setEditorStatus] = useState('');
  const [activeMediaPreview, setActiveMediaPreview] = useState<MediaPreviewState | null>(null);
  const [mediaRenameDraft, setMediaRenameDraft] = useState('');

  const currentIndex =
    memories.length > 0 ? ((virtualIndex % memories.length) + memories.length) % memories.length : 0;

  const windowProgressRaw = useMotionValue(0);
  const windowProgressSpring = useSpring(windowProgressRaw, {
    damping: 40,
    stiffness: 90,
    mass: 1,
  });

  const skyContainerRef = useRef<HTMLDivElement>(null);
  const windowContainerRef = useRef<HTMLDivElement>(null);
  const heroHeaderRef = useRef<HTMLDivElement>(null);
  const heroCopyRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const windowTitleRef = useRef<HTMLDivElement>(null);
  const archiveScrollRef = useRef<HTMLDivElement>(null);
  const noteEditorRef = useRef<HTMLDivElement>(null);
  const noteMediaInputRef = useRef<HTMLInputElement>(null);
  const memoriesRef = useRef<Memory[]>(memories);
  const pendingInsertRangeRef = useRef<Range | null>(null);
  const hasExplicitInsertAnchorRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const statusTimeoutRef = useRef<number | null>(null);

  const setCurrentIndex = (val: number | ((prev: number) => number)) => {
    setVirtualIndex((prevVirtual) => {
      const total = memoriesRef.current.length;
      if (total === 0) return 0;

      const currentReal = ((prevVirtual % total) + total) % total;
      const targetIdx = typeof val === 'function' ? val(currentReal) : val;

      let diff = targetIdx - currentReal;
      if (diff > total / 2) diff -= total;
      if (diff < -total / 2) diff += total;

      return prevVirtual + diff;
    });
  };

  const setEditorStatusMessage = (message: string, durationMs = 2600) => {
    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }

    setEditorStatus(message);
    if (durationMs > 0) {
      statusTimeoutRef.current = window.setTimeout(() => {
        setEditorStatus('');
        statusTimeoutRef.current = null;
      }, durationMs);
    }
  };

  const updateEditTimeInfo = (
    field: keyof Pick<MemoryTimeInfo, 'year' | 'month' | 'day' | 'period'>,
    value: string
  ) => {
    setEditTimeInfo((prev) => {
      const next = { ...prev, [field]: value };
      return applyTimeCascade(next);
    });
  };

  const openCustomTimeInput = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCustomTimeDraft(editTimeInfo.custom);
    setIsCustomTimeInputOpen(true);
  };

  const closeCustomTimeInput = () => {
    setIsCustomTimeInputOpen(false);
  };

  const applyCustomTimeInput = () => {
    setEditTimeInfo((prev) => ({ ...prev, custom: customTimeDraft.trim() }));
    setIsCustomTimeInputOpen(false);
  };

  const clearDraftSelection = () => {
    pendingInsertRangeRef.current = null;
    hasExplicitInsertAnchorRef.current = false;
  };

  const syncDraftInsertAnchor = () => {
    const editor = noteEditorRef.current;
    if (!editor || typeof window === 'undefined') {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (isUsableInsertionRange(editor, range)) {
      pendingInsertRangeRef.current = range.cloneRange();
      hasExplicitInsertAnchorRef.current = true;
      return;
    }
  };

  const restoreDraftSelection = () => {
    const editor = noteEditorRef.current;
    const savedRange = pendingInsertRangeRef.current;
    if (!editor || !savedRange || !hasExplicitInsertAnchorRef.current) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    selection.addRange(savedRange.cloneRange());
  };

  const insertDraftMedia = (items: MemoryNoteMedia[]) => {
    if (items.length === 0) return;

    const editor = noteEditorRef.current;
    const nextMedia = [...editNoteMedia, ...items];

    if (!editor) {
      const prefix = editNote && !editNote.endsWith('\n') && !editNote.endsWith(' ') ? ' ' : '';
      const insertedTokens = items.map((item) => buildMediaToken(item.id)).join(' ');
      setEditNote(`${editNote}${prefix}${insertedTokens}`.trim());
      setEditNoteMedia(nextMedia);
      return;
    }

    editor.focus();

    let range = hasExplicitInsertAnchorRef.current ? pendingInsertRangeRef.current : null;
    const selection = window.getSelection();

    if (!range || !editor.contains(range.startContainer)) {
      range = createEmptyRangeAtEnd(editor);
    }

    range.deleteContents();

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      fragment.appendChild(createEditorMediaNode(item));
      if (index < items.length - 1) {
        fragment.appendChild(document.createTextNode(' '));
      }
    });

    const trailingSpace = document.createTextNode(' ');
    fragment.appendChild(trailingSpace);
    range.insertNode(fragment);

    const caretRange = document.createRange();
    caretRange.setStartAfter(trailingSpace);
    caretRange.collapse(true);

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(caretRange);
    }

    pendingInsertRangeRef.current = caretRange.cloneRange();
    hasExplicitInsertAnchorRef.current = true;
    editor.dataset.mediaSignature = nextMedia.map((item) => `${item.id}:${item.label}`).join('|');
    setEditNoteMedia(nextMedia);
    setEditNote(serializeEditorContent(editor));
  };

  const buildDraftMediaItem = async (
    blob: Blob,
    kind: NoteMediaKind,
    label: string,
    mimeType?: string
  ): Promise<MemoryNoteMedia> => ({
    id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    url: await readBlobAsDataUrl(blob),
    label,
    mimeType,
  });

  const stopRecordingAndCleanup = () => {
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    setIsRecordingAudio(false);
  };

  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    windowProgressRaw.set(virtualIndex);
  }, [virtualIndex, windowProgressRaw]);

  useEffect(() => {
    localforage
      .getItem<Memory[]>('eel_diary_memories')
      .then((storedMemories) => {
        if (storedMemories && storedMemories.length > 0) {
          setMemories(storedMemories.map(normalizeMemory));
        }
        setIsLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load memories:', err);
        setIsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    localforage.setItem('eel_diary_memories', memories).catch((err) => {
      console.error('Failed to save memories:', err);
    });
  }, [isLoaded, memories]);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
    });

    const updateLenis = (time: number) => {
      lenis.raf(time * 1000);
    };

    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(updateLenis);
    gsap.ticker.lagSmoothing(0);

    const mm = gsap.matchMedia();

    mm.add('(min-width: 300px)', () => {
      if (
        !triggerRef.current ||
        !skyContainerRef.current ||
        !windowContainerRef.current ||
        !heroHeaderRef.current ||
        !heroCopyRef.current
      ) {
        return;
      }

      gsap.set(heroCopyRef.current, { yPercent: 100, opacity: 0 });

      const st = ScrollTrigger.create({
        trigger: triggerRef.current,
        start: 'top top',
        end: () => `+=${window.innerHeight * 3}px`,
        pin: true,
        scrub: 1,
        onUpdate: (self) => {
          const progress = self.progress;

          gsap.set(skyContainerRef.current, { scale: 1.1 - progress * 0.1 });

          const windowScale =
            progress <= 0.5 ? 1 + (progress / 0.5) * 4 : 5 + ((progress - 0.5) / 0.5) * 30;

          gsap.set(windowContainerRef.current, { scale: windowScale, transformOrigin: 'center center' });
          gsap.set(heroHeaderRef.current, { scale: 1 + progress * 2, opacity: 1 - progress * 2 });

          if (windowTitleRef.current) {
            const titleOpacity = 1 - Math.min(1, progress * 5);
            gsap.set(windowTitleRef.current, { opacity: titleOpacity });
          }

          gsap.set(heroCopyRef.current, {
            yPercent: 100 - progress * 100,
            opacity: progress * 2 > 1 ? 1 : progress * 2,
          });
        },
      });

      return () => st.kill();
    });

    return () => {
      lenis.destroy();
      gsap.ticker.remove(updateLenis);
      mm.revert();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current);
      }
      stopRecordingAndCleanup();
    };
  }, []);

  const handleNext = () => {
    if (memories.length === 0) return;
    setDirection(1);
    setVirtualIndex((prev) => prev + 1);
  };

  const handlePrev = () => {
    if (memories.length === 0) return;
    setDirection(-1);
    setVirtualIndex((prev) => prev - 1);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const newId = Date.now().toString();
        const fileType = file.type.startsWith('video/') ? 'video' : 'image';
        const createdDate = new Date().toISOString().split('T')[0];
        const newMemory: Memory = {
          id: newId,
          url: reader.result as string,
          type: fileType,
          title: '新的记忆',
          date: createdDate,
          note: '写下此时的感受...',
          noteMedia: [],
          timeInfo: normalizeTimeInfo(undefined, createdDate),
        };

        setMemories((prev) => {
          const next = [...prev, newMemory];
          window.setTimeout(() => {
            setDirection(1);
            setCurrentIndex(next.length - 1);
            setIsArchiveOpen(true);
            setEditingId(newId);
            setEditTitle(newMemory.title);
            setEditNote(newMemory.note);
            setEditNoteMedia([]);
            setEditTimeInfo(normalizeTimeInfo(newMemory.timeInfo, newMemory.date));
            setCustomTimeDraft('');
            setIsCustomTimeInputOpen(false);
            clearDraftSelection();

            window.setTimeout(() => {
              archiveScrollRef.current?.scrollTo({
                top: archiveScrollRef.current.scrollHeight,
                behavior: 'smooth',
              });
            }, 100);
          }, 50);
          return next;
        });
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': [],
      'video/*': [],
    },
  } as any);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (memories.length <= 1) return;
    setMemories((prev) => prev.filter((memory) => memory.id !== id));
    setCurrentIndex(0);
  };

  const submitEdit = (id: string, e?: React.FormEvent | React.MouseEvent | React.FocusEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    if (isRecordingAudio) {
      setEditorStatusMessage('请先结束录音', 1800);
      return false;
    }

    if (editTitle.trim() !== '') {
      setMemories((prev) =>
        prev.map((memory) =>
          memory.id === id
            ? {
                ...memory,
                title: editTitle.trim(),
                date: buildDateForSavedTimeInfo(editTimeInfo, memory.date),
                note: editNote.trim(),
                noteMedia: editNoteMedia,
                timeInfo: applyTimeCascade({ ...editTimeInfo, custom: editTimeInfo.custom.trim() }),
              }
            : memory
        )
      );
    }

    setEditingId(null);
    clearDraftSelection();
    return true;
  };

  const handleEdit = (
    id: string,
    currentTitle: string,
    currentNote: string,
    currentNoteMedia: MemoryNoteMedia[] = [],
    currentTimeInfo: MemoryTimeInfo | undefined,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    if (editingId && editingId !== id && !submitEdit(editingId)) {
      return;
    }
    setEditingId(id);
    setEditTitle(currentTitle);
    setEditNote(currentNote);
    setEditNoteMedia([...currentNoteMedia]);
    const nextTimeInfo = applyTimeCascade(
      normalizeTimeInfo(currentTimeInfo, memoriesRef.current.find((memory) => memory.id === id)?.date ?? '')
    );
    setEditTimeInfo(nextTimeInfo);
    setCustomTimeDraft(nextTimeInfo.custom);
    setIsCustomTimeInputOpen(false);
    clearDraftSelection();
  };

  const cancelEdit = () => {
    if (isRecordingAudio) {
      discardRecordingRef.current = true;
      mediaRecorderRef.current?.stop();
    }
    setIsCustomTimeInputOpen(false);
    setEditingId(null);
    clearDraftSelection();
  };

  const prepareMediaInsertion = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    syncDraftInsertAnchor();
  };

  const openNoteMediaPicker = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    noteMediaInputRef.current?.click();
  };

  const handleNoteMediaSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files: File[] = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length === 0) return;

    try {
      const items = await Promise.all(
        files.map(async (file) => {
          const kind: NoteMediaKind = file.type.startsWith('image/')
            ? 'image'
            : file.type.startsWith('video/')
              ? 'video'
              : 'audio';
          const cleanedName = file.name.replace(/\.[^.]+$/, '').trim();
          const fallbackName = kind === 'image' ? 'Photo' : kind === 'video' ? 'Video Clip' : 'Audio Clip';
          return buildDraftMediaItem(file, kind, cleanedName || fallbackName, file.type);
        })
      );

      insertDraftMedia(items);
      setEditorStatusMessage('媒体标签已插入', 2200);
    } catch (error) {
      console.error('Failed to attach media:', error);
      setEditorStatusMessage('媒体插入失败', 2200);
    }
  };

  const toggleAudioRecording = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isRecordingAudio) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setEditorStatusMessage('当前浏览器不支持录音', 2200);
      return;
    }

    try {
      discardRecordingRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: Event) => {
        console.error('Audio recording error:', event);
        stopRecordingAndCleanup();
        setEditorStatusMessage('录音失败', 2200);
      };

      recorder.onstop = async () => {
        const shouldDiscard = discardRecordingRef.current;
        const chunkBlob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stopRecordingAndCleanup();

        if (shouldDiscard || chunkBlob.size === 0) {
          discardRecordingRef.current = false;
          setEditorStatusMessage('录音已取消', 1800);
          return;
        }

        try {
          const timeLabel = new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          });
          const mediaItem = await buildDraftMediaItem(
            chunkBlob,
            'audio',
            `Voice Note ${timeLabel}`,
            recorder.mimeType || chunkBlob.type
          );
          insertDraftMedia([mediaItem]);
          setEditorStatusMessage('录音标签已插入', 2200);
        } catch (error) {
          console.error('Failed to save recorded audio:', error);
          setEditorStatusMessage('录音保存失败', 2200);
        }
      };

      recorder.start();
      setIsRecordingAudio(true);
      setEditorStatusMessage('录音中...', 0);
    } catch (error) {
      console.error('Failed to start audio recording:', error);
      stopRecordingAndCleanup();
      setEditorStatusMessage('麦克风不可用', 2200);
    }
  };

  const getMediaListForMemory = (memoryId: string) => {
    if (editingId === memoryId) {
      return editNoteMedia;
    }

    return memories.find((memory) => memory.id === memoryId)?.noteMedia ?? [];
  };

  const activePreviewMedia = activeMediaPreview
    ? getMediaListForMemory(activeMediaPreview.memoryId).find((item) => item.id === activeMediaPreview.mediaId) ?? null
    : null;
  const isPreviewEditable = Boolean(activeMediaPreview && editingId && activeMediaPreview.memoryId === editingId);

  useEffect(() => {
    setMediaRenameDraft(activePreviewMedia?.label ?? '');
  }, [activeMediaPreview?.mediaId, activeMediaPreview?.memoryId, activePreviewMedia?.label]);

  const openMediaPreview = (memoryId: string, media: MemoryNoteMedia) => {
    setActiveMediaPreview({ memoryId, mediaId: media.id });
  };

  const closeMediaPreview = () => {
    const preview = activeMediaPreview;
    setActiveMediaPreview(null);

    if (preview && preview.memoryId === editingId) {
      window.setTimeout(() => {
        restoreDraftSelection();
      }, 0);
    }
  };

  const savePreviewMediaLabel = () => {
    if (!activeMediaPreview || !activePreviewMedia) return;

    const nextLabel = mediaRenameDraft.trim();
    if (!nextLabel) {
      setEditorStatusMessage('标签名称不能为空', 1800);
      return;
    }

    if (activeMediaPreview.memoryId === editingId) {
      setEditNoteMedia((prev) =>
        prev.map((item) => (item.id === activeMediaPreview.mediaId ? { ...item, label: nextLabel } : item))
      );
    } else {
      setMemories((prev) =>
        prev.map((memory) =>
          memory.id === activeMediaPreview.memoryId
            ? {
                ...memory,
                noteMedia: (memory.noteMedia ?? []).map((item) =>
                  item.id === activeMediaPreview.mediaId ? { ...item, label: nextLabel } : item
                ),
              }
            : memory
        )
      );
    }

    setEditorStatusMessage('标签名称已更新', 1800);
  };

  const activeMemory = memories[currentIndex] || DEFAULT_MEMORIES[0];
  const activeMemoryMedia = activeMemory.noteMedia ?? [];

  return (
    <div className="min-h-[300vh] w-full bg-[#050507] font-serif text-[#E0E0E0]">
      <input
        ref={noteMediaInputRef}
        type="file"
        accept="image/*,audio/*,video/*"
        multiple
        className="hidden"
        onChange={handleNoteMediaSelection}
      />

      <section ref={triggerRef} className="hero-perspective relative h-screen w-full overflow-hidden bg-[#050507]">
        <div ref={skyContainerRef} className="absolute left-0 top-0 z-0 h-screen w-full overflow-hidden bg-black/50 will-change-transform">
          {memories.map((memory, idx) => (
            <SceneryLayer
              key={memory.id}
              memory={memory}
              idx={idx}
              total={memories.length}
              progress={windowProgressSpring}
            />
          ))}
        </div>

        <div ref={windowTitleRef} style={{ zIndex: 15 }} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="overflow-hidden rounded-sm border border-white/10 bg-[#050507]/40 px-6 py-2 backdrop-blur-sm">
            <AnimatePresence mode="wait">
              <motion.h2
                key={activeMemory.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-xl font-serif italic tracking-widest text-transparent"
              >
                {activeMemory.title}
              </motion.h2>
            </AnimatePresence>
          </div>
        </div>

        <div
          ref={windowContainerRef}
          className="pointer-events-none absolute inset-0 z-10 flex h-screen w-full items-center justify-center overflow-hidden will-change-transform"
        >
          <div className="window-hole pointer-events-auto relative h-[80vh] max-h-[700px] w-[80vw] max-w-[600px] flex-shrink-0 rounded-[150px] bg-transparent shadow-[0_20px_50px_rgba(0,0,0,0.5)] md:max-h-[800px] md:max-w-[700px]">
            <div className="window-glass-glare pointer-events-none absolute inset-0 z-20 rounded-[inherit]" />

            <div
              className="absolute left-0 top-0 z-30 flex h-full w-1/4 cursor-pointer items-center justify-start rounded-l-[150px] p-2 transition-colors hover:bg-white/10"
              onClick={handlePrev}
            >
              <ChevronLeft className="h-8 w-8 text-white/70" />
            </div>
            <div
              className="absolute right-0 top-0 z-30 flex h-full w-1/4 cursor-pointer items-center justify-end rounded-r-[150px] p-2 transition-colors hover:bg-white/10"
              onClick={handleNext}
            >
              <ChevronRight className="h-8 w-8 text-white/70" />
            </div>
          </div>
        </div>

        <div ref={heroHeaderRef} className="pointer-events-none absolute inset-0 z-20 hidden select-none flex-col justify-between p-10 md:flex">
          <div className="flex flex-col">
            <h1 className="mix-blend-difference text-2xl font-light uppercase tracking-[0.2em] text-white">Eel Diary</h1>
            <h2 className="mt-1 text-lg font-light tracking-[0.3em] text-white mix-blend-difference opacity-90">鳗鱼日记</h2>
            <span className="mt-2 text-[10px] uppercase tracking-[0.4em] opacity-40 mix-blend-difference">
              A Journey Through Memories
            </span>
          </div>
          <div className="text-right font-sans text-white mix-blend-difference">
            <p className="text-[11px] uppercase tracking-widest text-white/60">Observation Mode</p>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-white/40">Scroll down to immerse</p>
          </div>
        </div>

        <div ref={heroCopyRef} className="absolute inset-0 z-30 flex items-center justify-center bg-[#050507]/20 p-8 backdrop-blur-sm pointer-events-none">
          <div className="max-w-2xl text-center">
            <h1 className="mb-4 text-3xl italic leading-tight tracking-tighter text-white selection:bg-white selection:text-black md:text-5xl">
              {activeMemory.title}
            </h1>
            <p className="mb-6 text-[10px] uppercase tracking-widest text-white/40">{getMemoryDisplayTimeLabel(activeMemory)}</p>
            <NoteContent
              note={activeMemory.note}
              media={activeMemoryMedia}
              onMediaClick={(media) => openMediaPreview(activeMemory.id, media)}
              className="mx-auto mt-8 max-w-lg font-sans text-xs leading-relaxed tracking-wide text-white/60 pointer-events-auto"
            />
          </div>
        </div>
      </section>

      <button
        onClick={() => setIsArchiveOpen(true)}
        className="fixed bottom-8 right-8 z-[80] flex items-center justify-center rounded-full border border-white/20 bg-[#0A0B0D]/80 p-4 text-white/50 shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all hover:bg-white/10 hover:text-white"
        title="Open Console"
      >
        <LayoutGrid className="h-6 w-6" />
      </button>

      <AnimatePresence>
        {isArchiveOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050507]/90 p-4 backdrop-blur-xl md:p-12"
            onClick={() => {
              if (editingId) {
                submitEdit(editingId);
              } else {
                setIsArchiveOpen(false);
              }
            }}
          >
            <motion.div
              initial={{ y: 20, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="relative flex h-full max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-white/10 bg-[#0A0B0D] shadow-2xl"
              onClick={(e) => {
                e.stopPropagation();
                if (editingId) {
                  submitEdit(editingId);
                }
              }}
            >
              <button
                onClick={() => {
                  if (editingId && !submitEdit(editingId)) {
                    return;
                  }
                  setIsArchiveOpen(false);
                }}
                className="absolute right-8 top-8 z-[110] p-2 text-white/50 transition-colors hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>

              <header className="flex flex-shrink-0 flex-col items-start justify-between gap-6 border-b border-white/5 px-10 py-8 md:flex-row md:items-end">
                <div>
                  <h2 className="mb-2 text-2xl font-light uppercase tracking-[0.2em] text-white">Memory Archive</h2>
                  <p className="text-[10px] uppercase tracking-[0.4em] text-white/40">Manage your visual journal</p>
                </div>

                <div
                  {...getRootProps()}
                  className={`flex cursor-pointer items-center gap-2 rounded-sm border border-white/20 px-6 py-3 transition-all duration-300 ${
                    isDragActive ? 'bg-white/10 text-white' : 'text-[11px] uppercase tracking-widest text-white/80 hover:bg-white hover:text-black'
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="h-4 w-4" />
                  <span>{isDragActive ? 'Drop here' : 'Upload New Memory'}</span>
                </div>
              </header>

              <div
                ref={archiveScrollRef}
                className="min-h-0 flex-1 w-full overflow-y-auto overscroll-y-contain scroll-smooth"
                data-lenis-prevent="true"
              >
                <HorizontalArchive
                  memories={memories}
                  archiveScrollRef={archiveScrollRef}
                  currentIndex={currentIndex}
                  setCurrentIndex={setCurrentIndex}
                  setDirection={setDirection}
                  isArchiveOpen={isArchiveOpen}
                  setIsArchiveOpen={setIsArchiveOpen}
                  editingId={editingId}
                  editTitle={editTitle}
                  setEditTitle={setEditTitle}
                  editNote={editNote}
                  setEditNote={setEditNote}
                  editNoteMedia={editNoteMedia}
                  editTimeInfo={editTimeInfo}
                  updateEditTimeInfo={updateEditTimeInfo}
                  openCustomTimeInput={openCustomTimeInput}
                  noteEditorRef={noteEditorRef}
                  prepareMediaInsertion={prepareMediaInsertion}
                  syncDraftInsertAnchor={syncDraftInsertAnchor}
                  openNoteMediaPicker={openNoteMediaPicker}
                  toggleAudioRecording={toggleAudioRecording}
                  isRecordingAudio={isRecordingAudio}
                  editorStatus={editorStatus}
                  openMediaPreview={openMediaPreview}
                  submitEdit={submitEdit}
                  cancelEdit={cancelEdit}
                  handleEdit={handleEdit}
                  handleDelete={handleDelete}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCustomTimeInputOpen && editingId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[125] flex items-center justify-center bg-black/20 p-6 backdrop-blur-[2px]"
            onClick={closeCustomTimeInput}
          >
            <motion.div
              initial={{ y: 14, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 14, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-[calc(100vw-6rem)] max-w-[16.5rem] rounded-[1.5rem] border border-white/12 bg-[#0A0B0D]/96 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:max-w-[18rem]"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={customTimeDraft}
                onChange={(e) => setCustomTimeDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCustomTimeInput();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeCustomTimeInput();
                  }
                }}
                placeholder="输入任意时间"
                autoFocus
                className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-white/30"
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeCustomTimeInput();
                  }}
                  className="inline-flex min-h-[42px] items-center justify-center rounded-[1rem] border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/25 hover:bg-white/8 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    applyCustomTimeInput();
                  }}
                  className="inline-flex min-h-[42px] items-center justify-center rounded-[1rem] border border-white/12 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:border-white/25 hover:bg-white/16"
                >
                  确定
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeMediaPreview && activePreviewMedia && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-6 backdrop-blur-md"
            onClick={closeMediaPreview}
          >
            <motion.div
              initial={{ y: 16, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 16, scale: 0.98 }}
              className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#0A0B0D] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.4em] text-white/35">
                    {activePreviewMedia.kind === 'video'
                      ? 'Video Memory'
                      : activePreviewMedia.kind === 'image'
                        ? 'Photo Memory'
                        : 'Audio Memory'}
                  </p>
                  <h3 className="mt-2 text-xl font-light italic text-white">{activePreviewMedia.label}</h3>
                </div>
                <button
                  type="button"
                  onClick={closeMediaPreview}
                  className="rounded-full border border-white/10 p-2 text-white/50 transition-colors hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {isPreviewEditable ? (
                <div className="mb-5 flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-[0.3em] text-white/35">标签名称</label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      value={mediaRenameDraft}
                      onChange={(e) => setMediaRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          savePreviewMediaLabel();
                        }
                      }}
                      className="flex-1 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm text-white outline-none transition-colors focus:border-white/30"
                    />
                    <button
                      type="button"
                      onClick={savePreviewMediaLabel}
                      className="rounded-full border border-white/15 px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-white/80 transition-colors hover:border-white/35 hover:text-white"
                    >
                      保存名称
                    </button>
                  </div>
                </div>
              ) : null}

              {activePreviewMedia.kind === 'video' ? (
                <video
                  src={activePreviewMedia.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[70vh] w-full rounded-[20px] bg-black"
                />
              ) : activePreviewMedia.kind === 'image' ? (
                <img
                  src={activePreviewMedia.url}
                  alt={activePreviewMedia.label}
                  className="max-h-[70vh] w-full rounded-[20px] bg-black object-contain"
                />
              ) : (
                <audio src={activePreviewMedia.url} controls autoPlay className="w-full" />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
