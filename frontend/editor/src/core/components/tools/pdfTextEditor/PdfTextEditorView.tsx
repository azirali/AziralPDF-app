import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  ColorInput,
  Divider,
  Group,
  Menu,
  Modal,
  NumberInput,
  Pagination,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { useTranslation } from "react-i18next";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";
import MergeTypeIcon from "@mui/icons-material/MergeType";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFileOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import NearMeOutlinedIcon from "@mui/icons-material/NearMeOutlined";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import { Rnd } from "react-rnd";
import { useNavigationGuard } from "@app/contexts/NavigationContext";

import { useFileContext } from "@app/contexts/FileContext";
import {
  PdfTextEditorViewData,
  PdfJsonFont,
  PdfJsonPage,
  TextGroup,
} from "@app/tools/pdfTextEditor/pdfTextEditorTypes";
import {
  getImageBounds,
  getVectorPathBounds,
  pageDimensions,
  DEFAULT_ADD_TEXT_FONT_SIZE,
  DEFAULT_ADD_TEXT_COLOR,
  ADD_TEXT_MIN_FONT_SIZE,
  ADD_TEXT_MAX_FONT_SIZE,
  isAddedTextFontId,
  addedTextFontStyleFlags,
} from "@app/tools/pdfTextEditor/pdfTextEditorUtils";

const MAX_RENDER_WIDTH = 820;
const MIN_BOX_SIZE = 18;

const normalizeFontFormat = (format?: string | null): string => {
  if (!format) {
    return "ttf";
  }
  const lower = format.toLowerCase();
  if (lower.includes("woff2")) {
    return "woff2";
  }
  if (lower.includes("woff")) {
    return "woff";
  }
  if (lower.includes("otf")) {
    return "otf";
  }
  if (lower.includes("cff")) {
    return "otf";
  }
  return "ttf";
};

const getFontMimeType = (format: string): string => {
  switch (format) {
    case "woff2":
      return "font/woff2";
    case "woff":
      return "font/woff";
    case "otf":
      return "font/otf";
    default:
      return "font/ttf";
  }
};

const getFontFormatHint = (format: string): string | null => {
  switch (format) {
    case "woff2":
      return "woff2";
    case "woff":
      return "woff";
    case "otf":
      return "opentype";
    case "ttf":
      return "truetype";
    default:
      return null;
  }
};

const decodeBase64ToUint8Array = (value: string): Uint8Array => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const buildFontFamilyName = (font: PdfJsonFont): string => {
  const preferred = (font.baseName ?? "").trim();
  const identifier =
    preferred.length > 0
      ? preferred
      : (font.uid ?? font.id ?? "font").toString();
  return `pdf-font-${identifier.replace(/[^a-zA-Z0-9_-]/g, "")}`;
};

const getCaretOffset = (element: HTMLElement): number => {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    !element.contains(selection.focusNode)
  ) {
    return element.innerText.length;
  }
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.focusNode as Node, selection.focusOffset);
  return range.toString().length;
};

const setCaretOffset = (element: HTMLElement, offset: number): void => {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const targetOffset = Math.max(0, Math.min(offset, element.innerText.length));
  const range = document.createRange();
  let remaining = targetOffset;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const length = textNode.length;
    if (remaining <= length) {
      range.setStart(textNode, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }

  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const extractTextWithSoftBreaks = (
  element: HTMLElement,
): { text: string; insertedBreaks: boolean } => {
  const normalized = element.innerText.replace(/\u00A0/g, " ");
  if (!element.isConnected) {
    return { text: normalized, insertedBreaks: false };
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const range = document.createRange();
  let result = "";
  let previousTop: number | null = null;
  let insertedBreaks = false;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeText = node.textContent ?? "";
    for (let index = 0; index < nodeText.length; index += 1) {
      const char = nodeText[index];
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getClientRects()[0];

      if (
        previousTop !== null &&
        rect &&
        Math.abs(rect.top - previousTop) > 0.5 &&
        result[result.length - 1] !== "\n"
      ) {
        result += "\n";
        insertedBreaks = true;
      }

      result += char;
      if (rect) {
        previousTop = rect.top;
      }
      if (char === "\n") {
        previousTop = null;
      }
    }
  }

  return {
    text: result.replace(/\u00A0/g, " "),
    insertedBreaks,
  };
};

interface PdfTextEditorViewProps {
  data: PdfTextEditorViewData;
}

const toCssBounds = (
  _page: PdfJsonPage | null | undefined,
  pageHeight: number,
  scale: number,
  bounds: { left: number; right: number; top: number; bottom: number },
) => {
  const width = Math.max(bounds.right - bounds.left, 1);
  // Note: This codebase uses inverted naming where bounds.bottom > bounds.top
  // bounds.bottom = visually upper edge (larger Y in PDF coords)
  // bounds.top = visually lower edge (smaller Y in PDF coords)
  const height = Math.max(bounds.bottom - bounds.top, 1);
  const scaledWidth = Math.max(width * scale, MIN_BOX_SIZE);
  const scaledHeight = Math.max(height * scale, MIN_BOX_SIZE / 2);
  // Convert PDF's visually upper edge (bounds.bottom) to CSS top
  const top = Math.max(pageHeight - bounds.bottom, 0) * scale;

  return {
    left: bounds.left * scale,
    top,
    width: scaledWidth,
    height: scaledHeight,
  };
};

const normalizePageNumber = (
  pageIndex: number | null | undefined,
): number | null => {
  if (
    pageIndex === null ||
    pageIndex === undefined ||
    Number.isNaN(pageIndex)
  ) {
    return null;
  }
  return pageIndex + 1;
};

const buildFontLookupKeys = (
  fontId: string,
  font: PdfJsonFont | null | undefined,
  pageIndex: number | null | undefined,
): string[] => {
  const keys: string[] = [];
  const pageNumber = normalizePageNumber(pageIndex);
  if (pageNumber !== null) {
    keys.push(`${pageNumber}:${fontId}`);
  }
  if (font?.uid) {
    keys.push(font.uid);
  }
  if (font?.pageNumber !== null && font?.pageNumber !== undefined && font?.id) {
    keys.push(`${font.pageNumber}:${font.id}`);
  }
  keys.push(fontId);
  return Array.from(new Set(keys.filter((value) => value && value.length > 0)));
};

/**
 * Analyzes text groups on a page to determine if it's paragraph-heavy or sparse.
 * Returns true if the page appears to be document-like with substantial text content.
 */
const analyzePageContentType = (
  groups: TextGroup[],
  pageWidth: number,
): boolean => {
  if (groups.length === 0) return false;

  let totalWords = 0;
  let longTextGroups = 0;
  let totalGroups = 0;
  let fullWidthLines = 0;
  const wordCounts: number[] = [];
  const fullWidthThreshold = pageWidth * 0.7;

  groups.forEach((group) => {
    const text = (group.text || "").trim();
    if (text.length === 0) return;

    totalGroups++;
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

    totalWords += wordCount;
    wordCounts.push(wordCount);

    // Count text groups with substantial content (≥10 words or ≥50 chars)
    if (wordCount >= 10 || text.length >= 50) {
      longTextGroups++;
    }

    // Check if this line extends close to the right margin
    const rightEdge = group.bounds.right;
    if (rightEdge >= fullWidthThreshold) {
      fullWidthLines++;
    }
  });

  if (totalGroups === 0) return false;

  const avgWordsPerGroup = totalWords / totalGroups;
  const longTextRatio = longTextGroups / totalGroups;
  const fullWidthRatio = fullWidthLines / totalGroups;

  // Calculate variance in line lengths
  const variance =
    wordCounts.reduce((sum, count) => {
      const diff = count - avgWordsPerGroup;
      return sum + diff * diff;
    }, 0) / totalGroups;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation =
    avgWordsPerGroup > 0 ? stdDev / avgWordsPerGroup : 0;

  // All 3 criteria must pass for paragraph mode
  const criterion1 = avgWordsPerGroup > 5;
  const criterion2 = longTextRatio > 0.4;
  const criterion3 = coefficientOfVariation > 0.5 || fullWidthRatio > 0.6;

  const isParagraphPage = criterion1 && criterion2 && criterion3;

  return isParagraphPage;
};

// Minimum drag size (in CSS pixels) before a redaction rectangle is committed.
const MIN_REDACTION_CSS = 4;

const PdfTextEditorView = ({ data }: PdfTextEditorViewProps) => {
  const { t } = useTranslation();
  const { activeFiles } = useFileContext();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [activeVectorPathId, setActiveVectorPathId] = useState<string | null>(
    null,
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [widthOverrides, setWidthOverrides] = useState<Map<string, number>>(
    new Map(),
  );
  const draggingImageRef = useRef<string | null>(null);
  const rndRefs = useRef<Map<string, any>>(new Map());
  const pendingDragUpdateRef = useRef<number | null>(null);

  // Stage 2 editor palette: tool mode + redaction drawing state
  // "objects" (Stage 3 d) is a read-only-geometry preview mode: select/delete
  // extracted vector objects, no drag/resize/create like the other modes.
  const [editorMode, setEditorMode] = useState<
    "select" | "redact" | "text" | "objects"
  >("select");
  const [redactionColor, setRedactionColor] = useState<string>("#ffffff");
  // Stage 3: default size/colour for newly added text boxes
  const [addTextFontSize, setAddTextFontSize] = useState<number>(
    DEFAULT_ADD_TEXT_FONT_SIZE,
  );
  const [addTextColor, setAddTextColor] = useState<string>(
    DEFAULT_ADD_TEXT_COLOR,
  );
  const [addTextBold, setAddTextBold] = useState<boolean>(false);
  const [addTextItalic, setAddTextItalic] = useState<boolean>(false);
  const [redactionDraft, setRedactionDraft] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const redactionStartRef = useRef<{ x: number; y: number } | null>(null);
  const addImageInputRef = useRef<HTMLInputElement | null>(null);

  // Text-group drag-to-move (live CSS-pixel offset while dragging the handle).
  const movingRef = useRef<{
    groupId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const [moveDraft, setMoveDraft] = useState<
    Map<string, { dx: number; dy: number }>
  >(new Map());
  const [fontFamilies, setFontFamilies] = useState<Map<string, string>>(
    new Map(),
  );
  const [textScales, setTextScales] = useState<Map<string, number>>(new Map());
  const measurementKeyRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const caretOffsetsRef = useRef<Map<string, number>>(new Map());
  const composingGroupsRef = useRef<Set<string>>(new Set());
  const lastSelectedGroupIdRef = useRef<string | null>(null);
  const widthOverridesRef = useRef<Map<string, number>>(widthOverrides);
  const resizingRef = useRef<{
    groupId: string;
    startX: number;
    startWidth: number;
    baseWidth: number;
    maxWidth: number;
  } | null>(null);

  // First-time banner state
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(() => {
    try {
      return (
        localStorage.getItem("pdfTextEditor.welcomeBannerDismissed") !== "true"
      );
    } catch {
      return true;
    }
  });

  const handleDismissWelcomeBanner = useCallback(() => {
    // Just dismiss for this session, don't save to localStorage
    setShowWelcomeBanner(false);
  }, []);

  const handleDontShowAgain = useCallback(() => {
    // Save to localStorage to never show again
    try {
      localStorage.setItem("pdfTextEditor.welcomeBannerDismissed", "true");
    } catch {
      // Ignore localStorage errors
    }
    setShowWelcomeBanner(false);
  }, []);

  const {
    document: pdfDocument,
    groupsByPage,
    imagesByPage,
    vectorPathsByPage,
    vectorPathsLoadingPage,
    pagePreviews,
    selectedPage,
    dirtyPages,
    hasDocument,
    hasVectorPreview,
    fileName: _fileName,
    errorMessage,
    isGeneratingPdf: _isGeneratingPdf,
    isSavingToWorkbench: _isSavingToWorkbench,
    isConverting,
    conversionProgress,
    hasChanges: _hasChanges,
    forceSingleTextElement: _forceSingleTextElement,
    groupingMode: externalGroupingMode,
    autoScaleText,
    requestPagePreview,
    onSelectPage,
    onGroupEdit,
    onGroupDelete,
    onImageTransform,
    onImageReset,
    onImageDelete,
    onAddImage,
    onRequestVectorPaths,
    onVectorPathDelete,
    onAddRedaction,
    onAddText,
    onAddTextStyle,
    onGroupMove,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onReset: _onReset,
    onGeneratePdf: _onGeneratePdf,
    onSaveToWorkbench,
    onForceSingleTextElementChange: _onForceSingleTextElementChange,
    onGroupingModeChange: _onGroupingModeChange,
    onMergeGroups,
    onUngroupGroup,
    onLoadFile,
  } = data;

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y =
  // redo. While typing in a text field, defer to the browser's native
  // text-undo instead of stepping the whole document back.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!isUndo && !isRedo) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      event.preventDefault();
      if (isUndo) {
        onUndo();
      } else {
        onRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onUndo, onRedo]);

  // Vector paths are fetched once for the whole document (see loadVectorPaths
  // in the hook, which is idempotent) — this just guarantees the fetch has
  // been kicked off whenever Objects mode is active, even after remount.
  useEffect(() => {
    if (editorMode === "objects") {
      onRequestVectorPaths(selectedPage);
    }
  }, [editorMode, selectedPage, onRequestVectorPaths]);

  // Define derived variables immediately after props destructuring, before any hooks
  const pages = pdfDocument?.pages ?? [];
  const currentPage = pages[selectedPage] ?? null;
  const pageGroups = groupsByPage[selectedPage] ?? [];
  const pageImages = imagesByPage[selectedPage] ?? [];
  const pageVectorPaths = vectorPathsByPage[selectedPage] ?? [];
  const pagePreview = pagePreviews.get(selectedPage);
  const { width: pageWidth, height: pageHeight } = pageDimensions(currentPage);

  // Debug logging for page dimensions
  console.log(`📐 [PdfTextEditor] Page ${selectedPage + 1} Dimensions:`, {
    pageWidth,
    pageHeight,
    aspectRatio: pageHeight > 0 ? (pageWidth / pageHeight).toFixed(3) : "N/A",
    currentPage: currentPage
      ? {
          mediaBox: currentPage.mediaBox,
          cropBox: currentPage.cropBox,
          rotation: currentPage.rotation,
        }
      : null,
    documentMetadata: pdfDocument?.metadata
      ? {
          title: pdfDocument.metadata.title,
          pageCount: pages.length,
        }
      : null,
  });

  // Register navigation warning handlers for the global modal
  const {
    registerNavigationWarningHandlers,
    unregisterNavigationWarningHandlers,
  } = useNavigationGuard();
  useEffect(() => {
    registerNavigationWarningHandlers({
      onApplyAndContinue: onSaveToWorkbench,
    });
    return () => unregisterNavigationWarningHandlers();
  }, [
    onSaveToWorkbench,
    registerNavigationWarningHandlers,
    unregisterNavigationWarningHandlers,
  ]);

  const clearSelection = useCallback(() => {
    setSelectedGroupIds(new Set());
    lastSelectedGroupIdRef.current = null;
  }, []);

  useEffect(() => {
    widthOverridesRef.current = widthOverrides;
  }, [widthOverrides]);

  const resolveFont = useCallback(
    (
      fontId: string | null | undefined,
      pageIndex: number | null | undefined,
    ): PdfJsonFont | null => {
      if (!fontId || !pdfDocument?.fonts) {
        return null;
      }
      const fonts = pdfDocument.fonts;
      const pageNumber = normalizePageNumber(pageIndex);
      if (pageNumber !== null) {
        const pageMatch = fonts.find(
          (font) => font?.id === fontId && font?.pageNumber === pageNumber,
        );
        if (pageMatch) {
          return pageMatch;
        }
        const uidKey = `${pageNumber}:${fontId}`;
        const uidMatch = fonts.find((font) => font?.uid === uidKey);
        if (uidMatch) {
          return uidMatch;
        }
      }
      const directUid = fonts.find((font) => font?.uid === fontId);
      if (directUid) {
        return directUid;
      }
      return fonts.find((font) => font?.id === fontId) ?? null;
    },
    [pdfDocument?.fonts],
  );

  const getFontFamily = useCallback(
    (
      fontId: string | null | undefined,
      pageIndex: number | null | undefined,
    ): string => {
      if (!fontId) {
        return "sans-serif";
      }

      const font = resolveFont(fontId, pageIndex);
      const lookupKeys = buildFontLookupKeys(
        fontId,
        font ?? undefined,
        pageIndex,
      );
      for (const key of lookupKeys) {
        const loadedFamily = fontFamilies.get(key);
        if (loadedFamily) {
          return `'${loadedFamily}', sans-serif`;
        }
      }

      const fontName = font?.standard14Name || font?.baseName || "";
      const lowerName = fontName.toLowerCase();

      if (lowerName.includes("times")) {
        return '"Times New Roman", Times, serif';
      }
      if (lowerName.includes("helvetica") || lowerName.includes("arial")) {
        return "Arial, Helvetica, sans-serif";
      }
      if (lowerName.includes("courier")) {
        return '"Courier New", Courier, monospace';
      }
      if (lowerName.includes("symbol")) {
        return "Symbol, serif";
      }

      return "Arial, Helvetica, sans-serif";
    },
    [resolveFont, fontFamilies],
  );

  useEffect(() => {
    clearSelection();
  }, [clearSelection, selectedPage]);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, externalGroupingMode]);

  useEffect(() => {
    setWidthOverrides(new Map());
  }, [pdfDocument]);

  useEffect(() => {
    setSelectedGroupIds((prev) => {
      const filtered = Array.from(prev).filter((id) =>
        pageGroups.some((group) => group.id === id),
      );
      if (filtered.length === prev.size) {
        return prev;
      }
      return new Set(filtered);
    });
    setWidthOverrides((prev) => {
      const filtered = new Map<string, number>();
      pageGroups.forEach((group) => {
        if (prev.has(group.id)) {
          filtered.set(group.id, prev.get(group.id) ?? 0);
        }
      });
      if (filtered.size === prev.size) {
        return prev;
      }
      return filtered;
    });
  }, [pageGroups]);

  // Detect if current page contains paragraph-heavy content
  const isParagraphPage = useMemo(() => {
    const result = analyzePageContentType(pageGroups, pageWidth);
    console.log(
      `🏷️ Page ${selectedPage} badge: ${result ? "PARAGRAPH" : "SPARSE"} (${pageGroups.length} groups)`,
    );
    return result;
  }, [pageGroups, pageWidth, selectedPage]);
  const isParagraphLayout =
    externalGroupingMode === "paragraph" ||
    (externalGroupingMode === "auto" && isParagraphPage);

  const resolveGroupWidth = useCallback(
    (group: TextGroup): { width: number; base: number; max: number } => {
      const baseWidth = Math.max(group.bounds.right - group.bounds.left, 1);
      const maxWidth = Math.max(pageWidth - group.bounds.left, baseWidth);
      const override = widthOverrides.get(group.id);
      const resolved = override
        ? Math.min(Math.max(override, baseWidth), maxWidth)
        : baseWidth;
      return { width: resolved, base: baseWidth, max: maxWidth };
    },
    [pageWidth, widthOverrides],
  );

  const selectedGroupIdsArray = useMemo(
    () => Array.from(selectedGroupIds),
    [selectedGroupIds],
  );
  const selectionIndices = useMemo(() => {
    return selectedGroupIdsArray
      .map((id) => pageGroups.findIndex((group) => group.id === id))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
  }, [pageGroups, selectedGroupIdsArray]);
  const canMergeSelection =
    selectionIndices.length >= 2 &&
    selectionIndices.every(
      (value, idx, array) => idx === 0 || value === array[idx - 1] + 1,
    );
  const paragraphSelectionIds = useMemo(
    () =>
      selectedGroupIdsArray.filter((id) => {
        const target = pageGroups.find((group) => group.id === id);
        return target ? (target.childLineGroups?.length ?? 0) > 1 : false;
      }),
    [pageGroups, selectedGroupIdsArray],
  );
  const canUngroupSelection = paragraphSelectionIds.length > 0;
  const hasWidthOverrides = selectedGroupIdsArray.some((id) =>
    widthOverrides.has(id),
  );
  const hasSelection = selectedGroupIdsArray.length > 0;

  const syncEditorValue = useCallback(
    (
      element: HTMLElement,
      pageIndex: number,
      groupId: string,
      options?: { skipCaretRestore?: boolean },
    ) => {
      const { text: value } = extractTextWithSoftBreaks(element);
      const offset = getCaretOffset(element);
      caretOffsetsRef.current.set(groupId, offset);
      onGroupEdit(pageIndex, groupId, value);
      if (options?.skipCaretRestore) {
        return;
      }
      requestAnimationFrame(() => {
        if (editingGroupId !== groupId) {
          return;
        }
        const editor = editorRefs.current.get(groupId);
        if (editor) {
          const savedOffset =
            caretOffsetsRef.current.get(groupId) ?? editor.innerText.length;
          setCaretOffset(editor, savedOffset);
        }
      });
    },
    [editingGroupId, onGroupEdit],
  );

  const handleCompositionStart = useCallback((groupId: string) => {
    composingGroupsRef.current.add(groupId);
  }, []);

  const handleCompositionEnd = useCallback(
    (element: HTMLElement, pageIndex: number, groupId: string) => {
      composingGroupsRef.current.delete(groupId);
      syncEditorValue(element, pageIndex, groupId);
    },
    [syncEditorValue],
  );

  const handleMergeSelection = useCallback(() => {
    if (!canMergeSelection) {
      return;
    }
    const orderedIds = selectionIndices
      .map((index) => pageGroups[index]?.id)
      .filter((value): value is string => Boolean(value));
    if (orderedIds.length < 2) {
      return;
    }
    const merged = onMergeGroups(selectedPage, orderedIds);
    if (merged) {
      clearSelection();
    }
  }, [
    canMergeSelection,
    selectionIndices,
    pageGroups,
    onMergeGroups,
    selectedPage,
    clearSelection,
  ]);

  const handleUngroupSelection = useCallback(() => {
    if (!canUngroupSelection) {
      return;
    }
    let changed = false;
    paragraphSelectionIds.forEach((id) => {
      const result = onUngroupGroup(selectedPage, id);
      if (result) {
        changed = true;
      }
    });
    if (changed) {
      clearSelection();
    }
  }, [
    canUngroupSelection,
    paragraphSelectionIds,
    onUngroupGroup,
    selectedPage,
    clearSelection,
  ]);

  const handleWidthAdjustment = useCallback(
    (mode: "expand" | "reset") => {
      if (mode === "expand" && !hasSelection) {
        return;
      }
      if (mode === "reset" && !hasWidthOverrides) {
        return;
      }
      const selectedGroups = selectedGroupIdsArray
        .map((id) => pageGroups.find((group) => group.id === id))
        .filter((group): group is TextGroup => Boolean(group));
      if (selectedGroups.length === 0) {
        return;
      }
      setWidthOverrides((prev) => {
        const next = new Map(prev);
        selectedGroups.forEach((group) => {
          const baseWidth = Math.max(group.bounds.right - group.bounds.left, 1);
          const maxWidth = Math.max(pageWidth - group.bounds.left, baseWidth);
          if (mode === "expand") {
            next.set(group.id, maxWidth);
          } else {
            next.delete(group.id);
          }
        });
        return next;
      });
    },
    [
      hasSelection,
      hasWidthOverrides,
      selectedGroupIdsArray,
      pageGroups,
      pageWidth,
    ],
  );

  const extractPreferredFontId = useCallback((target?: TextGroup | null) => {
    if (!target) {
      return undefined;
    }
    if (target.fontId) {
      return target.fontId;
    }
    for (const element of target.originalElements ?? []) {
      if (element.fontId) {
        return element.fontId;
      }
    }
    for (const element of target.elements ?? []) {
      if (element.fontId) {
        return element.fontId;
      }
    }
    return undefined;
  }, []);

  const resolveFontIdForIndex = useCallback(
    (index: number): string | null | undefined => {
      if (index < 0 || index >= pageGroups.length) {
        return undefined;
      }
      const direct = extractPreferredFontId(pageGroups[index]);
      if (direct) {
        return direct;
      }
      for (let offset = 1; offset < pageGroups.length; offset += 1) {
        const prevIndex = index - offset;
        if (prevIndex >= 0) {
          const candidate = extractPreferredFontId(pageGroups[prevIndex]);
          if (candidate) {
            return candidate;
          }
        }
        const nextIndex = index + offset;
        if (nextIndex < pageGroups.length) {
          const candidate = extractPreferredFontId(pageGroups[nextIndex]);
          if (candidate) {
            return candidate;
          }
        }
      }
      return undefined;
    },
    [extractPreferredFontId, pageGroups],
  );

  const fontMetrics = useMemo(() => {
    const metrics = new Map<
      string,
      { unitsPerEm: number; ascent: number; descent: number }
    >();
    pdfDocument?.fonts?.forEach((font) => {
      if (!font?.id) {
        return;
      }
      const unitsPerEm =
        font.unitsPerEm && font.unitsPerEm > 0 ? font.unitsPerEm : 1000;
      const ascent = font.ascent ?? unitsPerEm;
      const descent = font.descent ?? -(unitsPerEm * 0.2);
      const metric = { unitsPerEm, ascent, descent };
      metrics.set(font.id, metric);
      if (font.uid) {
        metrics.set(font.uid, metric);
      }
      if (font.pageNumber !== null && font.pageNumber !== undefined) {
        metrics.set(`${font.pageNumber}:${font.id}`, metric);
      }
    });
    return metrics;
  }, [pdfDocument?.fonts]);

  useEffect(() => {
    if (typeof FontFace === "undefined") {
      setFontFamilies(new Map());
      return undefined;
    }

    let disposed = false;
    const active: { fontFace: FontFace; url?: string }[] = [];

    const registerFonts = async () => {
      const fonts = pdfDocument?.fonts ?? [];
      if (fonts.length === 0) {
        setFontFamilies(new Map());
        return;
      }

      const next = new Map<string, string>();
      const pickFontSource = (
        font: PdfJsonFont,
      ): {
        data: string;
        format?: string | null;
        source: "pdfProgram" | "webProgram" | "program";
      } | null => {
        if (font.pdfProgram && font.pdfProgram.length > 0) {
          return {
            data: font.pdfProgram,
            format: font.pdfProgramFormat,
            source: "pdfProgram",
          };
        }
        if (font.webProgram && font.webProgram.length > 0) {
          return {
            data: font.webProgram,
            format: font.webProgramFormat,
            source: "webProgram",
          };
        }
        if (font.program && font.program.length > 0) {
          return {
            data: font.program,
            format: font.programFormat,
            source: "program",
          };
        }
        return null;
      };

      const registerLoadedFontKeys = (
        font: PdfJsonFont,
        familyName: string,
      ) => {
        if (font.id) {
          next.set(font.id, familyName);
        }
        if (font.uid) {
          next.set(font.uid, familyName);
        }
        if (
          font.pageNumber !== null &&
          font.pageNumber !== undefined &&
          font.id
        ) {
          next.set(`${font.pageNumber}:${font.id}`, familyName);
        }
      };

      for (const font of fonts) {
        if (!font || !font.id) {
          continue;
        }
        const selection = pickFontSource(font);
        if (!selection) {
          continue;
        }
        try {
          const formatSource = selection.format;
          const format = normalizeFontFormat(formatSource);
          const data = decodeBase64ToUint8Array(selection.data);
          const blob = new Blob([data as BlobPart], {
            type: getFontMimeType(format),
          });
          const url = URL.createObjectURL(blob);
          const formatHint = getFontFormatHint(format);
          const familyName = buildFontFamilyName(font);
          const source = formatHint
            ? `url(${url}) format('${formatHint}')`
            : `url(${url})`;
          const fontFace = new FontFace(familyName, source);

          console.debug(
            `[FontLoader] Loading font ${font.id} (${font.baseName}) using ${selection.source}:`,
            {
              formatSource,
              format,
              formatHint,
              familyName,
              dataLength: data.length,
              hasPdfProgram: !!font.pdfProgram,
              hasWebProgram: !!font.webProgram,
              hasProgram: !!font.program,
            },
          );

          await fontFace.load();
          if (disposed) {
            document.fonts.delete(fontFace);
            URL.revokeObjectURL(url);
            continue;
          }
          document.fonts.add(fontFace);
          active.push({ fontFace, url });
          registerLoadedFontKeys(font, familyName);
          console.debug(`[FontLoader] Successfully loaded font ${font.id}`);
        } catch (error) {
          console.warn(
            `[FontLoader] Failed to load font ${font.id} (${font.baseName}) using ${selection.source}:`,
            {
              error: error instanceof Error ? error.message : String(error),
              formatSource: selection.format,
              hasPdfProgram: !!font.pdfProgram,
              hasWebProgram: !!font.webProgram,
              hasProgram: !!font.program,
            },
          );
          // Fallback to web-safe fonts is already implemented via getFontFamily()
        }
      }

      if (!disposed) {
        setFontFamilies(next);
      } else {
        active.forEach(({ fontFace, url }) => {
          document.fonts.delete(fontFace);
          if (url) {
            URL.revokeObjectURL(url);
          }
        });
      }
    };

    registerFonts();

    return () => {
      disposed = true;
      active.forEach(({ fontFace, url }) => {
        document.fonts.delete(fontFace);
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [pdfDocument?.fonts]);

  // Define helper functions that depend on hooks AFTER all hook calls
  const getFontMetricsFor = useCallback(
    (
      fontId: string | null | undefined,
      pageIndex: number | null | undefined,
    ): { unitsPerEm: number; ascent: number; descent: number } | undefined => {
      if (!fontId) {
        return undefined;
      }
      const font = resolveFont(fontId, pageIndex);
      const lookupKeys = buildFontLookupKeys(
        fontId,
        font ?? undefined,
        pageIndex,
      );
      for (const key of lookupKeys) {
        const metrics = fontMetrics.get(key);
        if (metrics) {
          return metrics;
        }
      }
      return undefined;
    },
    [resolveFont, fontMetrics],
  );

  const getLineHeightPx = useCallback(
    (
      fontId: string | null | undefined,
      pageIndex: number | null | undefined,
      fontSizePx: number,
    ): number => {
      if (fontSizePx <= 0) {
        return fontSizePx;
      }
      const metrics = getFontMetricsFor(fontId, pageIndex);
      if (!metrics || metrics.unitsPerEm <= 0) {
        return fontSizePx * 1.2;
      }
      const unitsPerEm = metrics.unitsPerEm > 0 ? metrics.unitsPerEm : 1000;
      const ascentUnits = metrics.ascent ?? unitsPerEm;
      const descentUnits = Math.abs(metrics.descent ?? -(unitsPerEm * 0.2));
      const totalUnits = Math.max(unitsPerEm, ascentUnits + descentUnits);
      if (totalUnits <= 0) {
        return fontSizePx * 1.2;
      }
      const lineHeight = (totalUnits / unitsPerEm) * fontSizePx;
      return Math.max(lineHeight, fontSizePx * 1.05);
    },
    [getFontMetricsFor],
  );

  const getFontGeometry = useCallback(
    (
      fontId: string | null | undefined,
      pageIndex: number | null | undefined,
    ):
      | {
          unitsPerEm: number;
          ascentUnits: number;
          descentUnits: number;
          totalUnits: number;
          ascentRatio: number;
          descentRatio: number;
        }
      | undefined => {
      const metrics = getFontMetricsFor(fontId, pageIndex);
      if (!metrics) {
        return undefined;
      }
      const unitsPerEm = metrics.unitsPerEm > 0 ? metrics.unitsPerEm : 1000;
      const rawAscent = metrics.ascent ?? unitsPerEm;
      const rawDescent = metrics.descent ?? -(unitsPerEm * 0.2);
      const ascentUnits = Number.isFinite(rawAscent) ? rawAscent : unitsPerEm;
      const descentUnits = Number.isFinite(rawDescent)
        ? Math.abs(rawDescent)
        : unitsPerEm * 0.2;
      const totalUnits = Math.max(unitsPerEm, ascentUnits + descentUnits);
      if (totalUnits <= 0 || !Number.isFinite(totalUnits)) {
        return undefined;
      }
      return {
        unitsPerEm,
        ascentUnits,
        descentUnits,
        totalUnits,
        ascentRatio: ascentUnits / totalUnits,
        descentRatio: descentUnits / totalUnits,
      };
    },
    [getFontMetricsFor],
  );

  const getFontWeight = useCallback(
    (
      fontId: string | null | undefined,
      pageIndex: number | null | undefined,
    ): number | "normal" | "bold" => {
      if (!fontId) {
        return "normal";
      }
      const font = resolveFont(fontId, pageIndex);
      if (!font || !font.fontDescriptorFlags) {
        return "normal";
      }

      // PDF font descriptor flag bit 18 (value 262144 = 0x40000) indicates ForceBold
      const FORCE_BOLD_FLAG = 262144;
      if ((font.fontDescriptorFlags & FORCE_BOLD_FLAG) !== 0) {
        return "bold";
      }

      // Also check if font name contains "Bold"
      const fontName = font.standard14Name || font.baseName || "";
      if (fontName.toLowerCase().includes("bold")) {
        return "bold";
      }

      return "normal";
    },
    [resolveFont],
  );

  const visibleGroups = useMemo(
    () =>
      pageGroups
        .map((group, index) => ({ group, pageGroupIndex: index }))
        .filter(({ group }) => {
          const hasContent =
            (group.text ?? "").trim().length > 0 ||
            (group.originalText ?? "").trim().length > 0;
          return hasContent || editingGroupId === group.id;
        }),
    [editingGroupId, pageGroups],
  );

  const orderedImages = useMemo(() => {
    const areaOf = (image: (typeof pageImages)[number]) => {
      const b = getImageBounds(image);
      return Math.max(b.right - b.left, 0) * Math.max(b.top - b.bottom, 0);
    };
    return [...pageImages].sort((first, second) => {
      const z = (first?.zOrder ?? -1_000_000) - (second?.zOrder ?? -1_000_000);
      if (z !== 0) return z;
      // Tie-break by area DESCENDING so a larger (often full-bleed background)
      // image is painted first and sits BELOW smaller foreground images when
      // the backend gives no/equal z-order.
      return areaOf(second) - areaOf(first);
    });
  }, [pageImages]);
  const scale = useMemo(() => {
    const calculatedScale = Math.min(MAX_RENDER_WIDTH / pageWidth, 2.5);
    console.log(`🔍 [PdfTextEditor] Scale Calculation:`, {
      MAX_RENDER_WIDTH,
      pageWidth,
      pageHeight,
      calculatedScale: calculatedScale.toFixed(3),
      scaledWidth: (pageWidth * calculatedScale).toFixed(2),
      scaledHeight: (pageHeight * calculatedScale).toFixed(2),
    });
    return calculatedScale;
  }, [pageWidth, pageHeight]);
  const scaledWidth = pageWidth * scale;
  const scaledHeight = pageHeight * scale;
  const selectionToolbarPosition = useMemo(() => {
    if (!hasSelection) {
      return null;
    }
    const firstSelected = pageGroups.find((group) =>
      selectedGroupIds.has(group.id),
    );
    if (!firstSelected) {
      return null;
    }
    const bounds = toCssBounds(
      currentPage,
      pageHeight,
      scale,
      firstSelected.bounds,
    );
    const top = Math.max(bounds.top - 40, 8);
    const left = Math.min(
      Math.max(bounds.left, 8),
      Math.max(scaledWidth - 220, 8),
    );
    return { left, top };
  }, [
    hasSelection,
    pageGroups,
    selectedGroupIds,
    currentPage,
    pageHeight,
    scale,
    scaledWidth,
  ]);

  useEffect(() => {
    if (!hasDocument || !hasVectorPreview) {
      return;
    }
    requestPagePreview(selectedPage, scale);
    if (selectedPage + 1 < pages.length) {
      requestPagePreview(selectedPage + 1, scale);
    }
  }, [
    hasDocument,
    hasVectorPreview,
    selectedPage,
    scale,
    pages.length,
    requestPagePreview,
  ]);

  useEffect(() => {
    setActiveGroupId(null);
    setEditingGroupId(null);
    setActiveImageId(null);
    setTextScales(new Map());
    measurementKeyRef.current = "";
  }, [selectedPage]);

  // Measure text widths once per page/configuration and apply static scaling
  useLayoutEffect(() => {
    if (!autoScaleText) {
      // Clear all scales when auto-scale is disabled
      setTextScales(new Map());
      measurementKeyRef.current = "";
      return;
    }

    if (visibleGroups.length === 0) {
      return;
    }

    // Create a stable key for this measurement configuration
    const currentKey = `${selectedPage}-${fontFamilies.size}-${autoScaleText}`;

    // Skip if we've already measured for this configuration
    if (measurementKeyRef.current === currentKey) {
      return;
    }

    const measureTextScales = () => {
      const newScales = new Map<string, number>();

      visibleGroups.forEach(({ group }) => {
        // Skip groups that are being edited
        if (editingGroupId === group.id) {
          return;
        }

        // Only apply auto-scaling to unchanged text
        const hasChanges = group.text !== group.originalText;
        if (hasChanges) {
          newScales.set(group.id, 1);
          return;
        }

        const lineCount = (group.text || "").split("\n").length;

        // Skip multi-line paragraphs - auto-scaling doesn't work well with wrapped text
        if (lineCount > 1) {
          newScales.set(group.id, 1);
          return;
        }

        const element = document.querySelector<HTMLElement>(
          `[data-text-group="${group.id}"]`,
        );
        if (!element) {
          return;
        }

        const textSpan = element.querySelector<HTMLSpanElement>(
          "span[data-text-content]",
        );
        if (!textSpan) {
          return;
        }

        // Temporarily remove any existing transform to get natural width
        const originalTransform = textSpan.style.transform;
        textSpan.style.transform = "none";

        const _bounds = toCssBounds(
          currentPage,
          pageHeight,
          scale,
          group.bounds,
        );
        const { width: resolvedWidth } = resolveGroupWidth(group);
        const containerWidth = resolvedWidth * scale;
        const textWidth = textSpan.getBoundingClientRect().width;

        // Restore original transform
        textSpan.style.transform = originalTransform;

        // Only scale if text overflows by more than 2%
        if (textWidth > 0 && textWidth > containerWidth * 1.02) {
          const scaleX = Math.max(containerWidth / textWidth, 0.5); // Min 50% scale
          newScales.set(group.id, scaleX);
        } else {
          newScales.set(group.id, 1);
        }
      });

      // Mark this configuration as measured
      measurementKeyRef.current = currentKey;
      setTextScales(newScales);
    };

    // Delay measurement to ensure fonts and layout are ready
    const timer = setTimeout(measureTextScales, 150);
    return () => clearTimeout(timer);
  }, [
    autoScaleText,
    visibleGroups,
    editingGroupId,
    currentPage,
    pageHeight,
    scale,
    fontFamilies.size,
    selectedPage,
    isParagraphLayout,
    resolveGroupWidth,
  ]);

  useLayoutEffect(() => {
    // Only restore caret position during re-renders while already editing
    // Don't interfere with initial click-to-position behavior
    if (!editingGroupId) {
      return;
    }
    const editor = editorRefs.current.get(editingGroupId);
    if (!editor) {
      return;
    }
    const offset = caretOffsetsRef.current.get(editingGroupId);
    // Only restore if we have a saved offset (meaning user was already typing)
    if (offset === undefined || offset === 0) {
      return;
    }
    setCaretOffset(editor, offset);
  }, [editingGroupId, groupsByPage, imagesByPage]);

  useEffect(() => {
    if (!editingGroupId) {
      return;
    }
    const editor = document.querySelector<HTMLElement>(
      `[data-editor-group="${editingGroupId}"]`,
    );
    if (editor) {
      if (document.activeElement !== editor) {
        editor.focus();
      }
    }
  }, [editingGroupId]);

  // Sync image positions when not dragging (handles stutters/re-renders)
  useLayoutEffect(() => {
    const isDragging = draggingImageRef.current !== null;
    if (isDragging) {
      return; // Don't sync during drag
    }

    pageImages.forEach((image) => {
      if (!image?.id) return;

      const imageId = image.id;
      const rndRef = rndRefs.current.get(imageId);
      if (!rndRef || !rndRef.updatePosition) return;

      const bounds = getImageBounds(image);
      const _width = Math.max(bounds.right - bounds.left, 1);
      const _height = Math.max(bounds.top - bounds.bottom, 1);
      const cssLeft = bounds.left * scale;
      const cssTop = (pageHeight - bounds.top) * scale;

      // Get current position from Rnd component
      const currentState = rndRef.state || {};
      const currentX = currentState.x ?? 0;
      const currentY = currentState.y ?? 0;

      // Calculate drift
      const drift = Math.abs(currentX - cssLeft) + Math.abs(currentY - cssTop);

      // Only sync if drift is significant (more than 3px)
      if (drift > 3) {
        rndRef.updatePosition({ x: cssLeft, y: cssTop });
      }
    });
  }, [pageImages, scale, pageHeight]);

  const handlePageChange = (pageNumber: number) => {
    setActiveGroupId(null);
    setEditingGroupId(null);
    clearSelection();
    onSelectPage(pageNumber - 1);
  };

  const handleBackgroundClick = () => {
    setEditingGroupId(null);
    setActiveGroupId(null);
    setActiveImageId(null);
    clearSelection();
  };

  const handleSelectionInteraction = useCallback(
    (groupId: string, groupIndex: number, event: React.MouseEvent): boolean => {
      const multiSelect = event.metaKey || event.ctrlKey;
      const rangeSelect =
        event.shiftKey && lastSelectedGroupIdRef.current !== null;
      setSelectedGroupIds((previous) => {
        if (multiSelect) {
          const next = new Set(previous);
          if (next.has(groupId)) {
            next.delete(groupId);
          } else {
            next.add(groupId);
          }
          return next;
        }
        if (rangeSelect) {
          const anchorId = lastSelectedGroupIdRef.current;
          const anchorIndex = anchorId
            ? pageGroups.findIndex((group) => group.id === anchorId)
            : -1;
          if (anchorIndex === -1) {
            return new Set([groupId]);
          }
          const start = Math.min(anchorIndex, groupIndex);
          const end = Math.max(anchorIndex, groupIndex);
          const next = new Set<string>();
          for (let idx = start; idx <= end; idx += 1) {
            const candidate = pageGroups[idx];
            if (candidate) {
              next.add(candidate.id);
            }
          }
          return next;
        }
        return new Set([groupId]);
      });
      if (!rangeSelect) {
        lastSelectedGroupIdRef.current = groupId;
      }
      return !(multiSelect || rangeSelect);
    },
    [pageGroups],
  );

  const handleResizeStart = useCallback(
    (event: React.MouseEvent, group: TextGroup, currentWidth: number) => {
      const baseWidth = Math.max(group.bounds.right - group.bounds.left, 1);
      const maxWidth = Math.max(pageWidth - group.bounds.left, baseWidth);
      event.stopPropagation();
      event.preventDefault();
      const startX = event.clientX;
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const context = resizingRef.current;
        if (!context) {
          return;
        }
        moveEvent.preventDefault();
        const deltaPx = moveEvent.clientX - context.startX;
        const deltaWidth = deltaPx / scale;
        const nextWidth = Math.min(
          Math.max(context.startWidth + deltaWidth, context.baseWidth),
          context.maxWidth,
        );
        setWidthOverrides((prev) => {
          const next = new Map(prev);
          if (Math.abs(nextWidth - context.baseWidth) <= 0.5) {
            next.delete(context.groupId);
          } else {
            next.set(context.groupId, nextWidth);
          }
          return next;
        });
      };
      const handleMouseUp = () => {
        resizingRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      resizingRef.current = {
        groupId: group.id,
        startX,
        startWidth: currentWidth,
        baseWidth,
        maxWidth,
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [pageWidth, scale],
  );

  // Corner-drag font scaling for added-text boxes: vertical drag grows/shrinks
  // the font size, routed through onAddTextStyle (same coalescing undo tag as
  // the size picker, so a whole drag is one undo step). Only added-text groups
  // round-trip a size change via the regenerate path.
  const handleFontScaleStart = useCallback(
    (event: React.MouseEvent, group: TextGroup) => {
      event.stopPropagation();
      event.preventDefault();
      const startY = event.clientY;
      const startSize =
        group.fontMatrixSize ?? group.fontSize ?? DEFAULT_ADD_TEXT_FONT_SIZE;
      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaPt = (moveEvent.clientY - startY) / scale;
        const nextSize = Math.max(
          ADD_TEXT_MIN_FONT_SIZE,
          Math.min(ADD_TEXT_MAX_FONT_SIZE, startSize + deltaPt),
        );
        onAddTextStyle(group.pageIndex, group.id, { fontSize: nextSize });
      };
      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onAddTextStyle, scale],
  );

  const handleMoveStart = useCallback(
    (event: React.MouseEvent, groupId: string) => {
      event.stopPropagation();
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      movingRef.current = { groupId, startX, startY };
      setActiveGroupId(groupId);
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const context = movingRef.current;
        if (!context) {
          return;
        }
        moveEvent.preventDefault();
        const dx = moveEvent.clientX - context.startX;
        const dy = moveEvent.clientY - context.startY;
        setMoveDraft((prev) => {
          const next = new Map(prev);
          next.set(context.groupId, { dx, dy });
          return next;
        });
      };
      const handleMouseUp = (upEvent: MouseEvent) => {
        const context = movingRef.current;
        movingRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        if (!context) {
          return;
        }
        setMoveDraft((prev) => {
          const next = new Map(prev);
          next.delete(context.groupId);
          return next;
        });
        const dx = upEvent.clientX - context.startX;
        const dy = upEvent.clientY - context.startY;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
          return;
        }
        // Screen y grows downward; PDF y grows upward -> negate dy.
        onGroupMove(selectedPage, context.groupId, dx / scale, -dy / scale);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onGroupMove, scale, selectedPage],
  );

  const renderGroupContainer = (
    groupId: string,
    pageIndex: number,
    isActive: boolean,
    isChanged: boolean,
    content: React.ReactNode,
    onActivate?: (event: React.MouseEvent) => void,
    onClick?: (event: React.MouseEvent) => void,
    isSelected = false,
    resizeHandle?: React.ReactNode,
  ) => (
    <Box
      component="div"
      style={{
        width: "calc(100% + 4px)",
        height: "calc(100% + 6px)",
        marginLeft: "-2px",
        marginTop: "-3px",
        outline: isActive
          ? "2px solid var(--mantine-color-blue-5)"
          : isSelected
            ? "1px solid var(--mantine-color-violet-5)"
            : isChanged
              ? "1px solid var(--mantine-color-yellow-5)"
              : // Faint dashed border so editable boxes are always discoverable,
                // even over dark page backgrounds.
                "1px dashed var(--mantine-color-blue-3)",
        outlineOffset: "-1px",
        borderRadius: 6,
        backgroundColor: isActive
          ? "rgba(184,212,255,0.35)"
          : isSelected
            ? "rgba(206,190,255,0.32)"
            : isChanged
              ? "rgba(250,255,189,0.28)"
              : "transparent",
        transition: "outline 120ms ease, background-color 120ms ease",
        pointerEvents: "auto",
        overflow: "visible",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: "3px 2px 3px 2px",
        position: "relative",
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (onClick) {
          onClick(event);
        } else {
          onActivate?.(event);
        }
      }}
    >
      {content}
      {resizeHandle}
      {activeGroupId === groupId && (
        <ActionIcon
          size="xs"
          variant="filled"
          color="red"
          radius="xl"
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            zIndex: 9999,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
            event.preventDefault();

            // Find the current group to check if it's already empty
            const currentGroups = groupsByPage[pageIndex] ?? [];
            const currentGroup = currentGroups.find((g) => g.id === groupId);
            const currentText = (currentGroup?.text ?? "").trim();

            if (currentText.length === 0) {
              // Already empty - remove the textbox entirely
              onGroupDelete(pageIndex, groupId);
              setActiveGroupId(null);
              setEditingGroupId(null);
            } else {
              // Has text - clear it but keep the textbox
              onGroupEdit(pageIndex, groupId, "");
            }
          }}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
          }}
        >
          <CloseIcon style={{ fontSize: 12 }} />
        </ActionIcon>
      )}
      {activeGroupId === groupId && (
        <Tooltip
          label={t("pdfTextEditor.manual.move", "Drag to move")}
          withinPortal
        >
          <ActionIcon
            size="xs"
            variant="filled"
            color="blue"
            radius="xl"
            aria-label={t("pdfTextEditor.manual.move", "Drag to move")}
            style={{
              position: "absolute",
              top: -8,
              left: -8,
              zIndex: 9999,
              cursor: "move",
              pointerEvents: "auto",
            }}
            onMouseDown={(event) => handleMoveStart(event, groupId)}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
            }}
          >
            <OpenWithIcon style={{ fontSize: 12 }} />
          </ActionIcon>
        </Tooltip>
      )}
    </Box>
  );

  const emitImageTransform = useCallback(
    (
      imageId: string,
      leftPx: number,
      topPx: number,
      widthPx: number,
      heightPx: number,
    ) => {
      const rawLeft = leftPx / scale;
      const rawTop = pageHeight - topPx / scale;
      const width = Math.max(widthPx / scale, 0.01);
      const height = Math.max(heightPx / scale, 0.01);
      const maxLeft = Math.max(pageWidth - width, 0);
      const left = Math.min(Math.max(rawLeft, 0), maxLeft);
      const minTop = Math.min(height, pageHeight);
      const top = Math.min(Math.max(rawTop, minTop), pageHeight);
      const bottom = Math.max(top - height, 0);
      onImageTransform(selectedPage, imageId, {
        left,
        bottom,
        width,
        height,
        transform: [],
      });
    },
    [onImageTransform, pageHeight, pageWidth, scale, selectedPage],
  );

  const handleRedactionPointerDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      redactionStartRef.current = { x, y };
      setRedactionDraft({ left: x, top: y, width: 0, height: 0 });
    },
    [],
  );

  const handleRedactionPointerMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const start = redactionStartRef.current;
      if (!start) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setRedactionDraft({
        left: Math.min(start.x, x),
        top: Math.min(start.y, y),
        width: Math.abs(x - start.x),
        height: Math.abs(y - start.y),
      });
    },
    [],
  );

  const handleRedactionPointerUp = useCallback(() => {
    const draft = redactionDraft;
    redactionStartRef.current = null;
    setRedactionDraft(null);
    if (
      !draft ||
      draft.width < MIN_REDACTION_CSS ||
      draft.height < MIN_REDACTION_CSS
    ) {
      return;
    }
    const left = draft.left / scale;
    const width = draft.width / scale;
    const height = draft.height / scale;
    const bottom = pageHeight - (draft.top + draft.height) / scale;
    onAddRedaction(selectedPage, {
      left,
      bottom,
      width,
      height,
      color: redactionColor,
    });
  }, [
    onAddRedaction,
    pageHeight,
    redactionColor,
    redactionDraft,
    scale,
    selectedPage,
  ]);

  const handleAddImageChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        void onAddImage(selectedPage, file);
      }
    },
    [onAddImage, selectedPage],
  );

  const handleTextPlacePointerDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const pdfX = px / scale;
      const pdfTopY = pageHeight - py / scale;
      // Place the click at the top of the glyphs: drop the baseline by ~ascent.
      const baselineY = pdfTopY - addTextFontSize * 0.72;
      const newId = onAddText(
        selectedPage,
        pdfX,
        baselineY,
        addTextFontSize,
        addTextColor,
        addTextBold,
        addTextItalic,
      );
      setEditorMode("select");
      setActiveImageId(null);
      setSelectedGroupIds(new Set());
      setActiveGroupId(newId);
      setEditingGroupId(newId);
    },
    [
      addTextBold,
      addTextColor,
      addTextFontSize,
      addTextItalic,
      onAddText,
      pageHeight,
      scale,
      selectedPage,
    ],
  );

  // The currently selected added-text box (if any) on the current page. Size /
  // colour controls edit it live; otherwise they set defaults for the next box.
  const activeAddedGroup = useMemo(
    () =>
      activeGroupId
        ? (pageGroups.find(
            (group) =>
              group.id === activeGroupId && isAddedTextFontId(group.fontId),
          ) ?? null)
        : null,
    [activeGroupId, pageGroups],
  );

  const showTextStyleControls =
    editorMode === "text" || Boolean(activeAddedGroup);

  const addTextFontSizeValue = activeAddedGroup
    ? (activeAddedGroup.fontMatrixSize ??
      activeAddedGroup.fontSize ??
      addTextFontSize)
    : addTextFontSize;
  const addTextColorValue = activeAddedGroup
    ? (activeAddedGroup.color ?? addTextColor)
    : addTextColor;
  const activeStyleFlags = activeAddedGroup
    ? addedTextFontStyleFlags(activeAddedGroup.fontId)
    : null;
  const addTextBoldValue = activeStyleFlags
    ? activeStyleFlags.bold
    : addTextBold;
  const addTextItalicValue = activeStyleFlags
    ? activeStyleFlags.italic
    : addTextItalic;

  const handleAddTextFontSizeChange = useCallback(
    (value: number | string) => {
      const numeric = typeof value === "number" ? value : parseFloat(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      const size = Math.max(
        ADD_TEXT_MIN_FONT_SIZE,
        Math.min(ADD_TEXT_MAX_FONT_SIZE, numeric),
      );
      setAddTextFontSize(size);
      if (activeAddedGroup) {
        onAddTextStyle(selectedPage, activeAddedGroup.id, { fontSize: size });
      }
    },
    [activeAddedGroup, onAddTextStyle, selectedPage],
  );

  const handleAddTextColorChange = useCallback(
    (value: string) => {
      setAddTextColor(value);
      if (activeAddedGroup) {
        onAddTextStyle(selectedPage, activeAddedGroup.id, { color: value });
      }
    },
    [activeAddedGroup, onAddTextStyle, selectedPage],
  );

  const handleAddTextBoldToggle = useCallback(() => {
    const next = !addTextBoldValue;
    setAddTextBold(next);
    if (activeAddedGroup) {
      onAddTextStyle(selectedPage, activeAddedGroup.id, { bold: next });
    }
  }, [activeAddedGroup, addTextBoldValue, onAddTextStyle, selectedPage]);

  const handleAddTextItalicToggle = useCallback(() => {
    const next = !addTextItalicValue;
    setAddTextItalic(next);
    if (activeAddedGroup) {
      onAddTextStyle(selectedPage, activeAddedGroup.id, { italic: next });
    }
  }, [activeAddedGroup, addTextItalicValue, onAddTextStyle, selectedPage]);

  return (
    <Stack
      gap="xl"
      className="h-full"
      style={{
        padding: "1.5rem",
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {errorMessage && (
        <Alert
          icon={<WarningAmberIcon fontSize="small" />}
          color="red"
          radius="md"
          mb="md"
        >
          {errorMessage}
        </Alert>
      )}

      {!hasDocument && !isConverting && (
        <Stack
          align="center"
          justify="center"
          style={{ flex: 1, height: "100%" }}
        >
          <Dropzone
            onDrop={(files) => {
              if (files.length > 0) {
                onLoadFile(files[0]);
              }
            }}
            accept={["application/pdf", "application/json"]}
            maxFiles={1}
            style={{
              width: "100%",
              maxWidth: 480,
              minHeight: 200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px dashed var(--mantine-color-gray-4)",
              borderRadius: "var(--mantine-radius-lg)",
              cursor: "pointer",
              transition:
                "border-color 150ms ease, background-color 150ms ease",
            }}
          >
            <Stack align="center" gap="md" style={{ pointerEvents: "none" }}>
              <UploadFileIcon
                sx={{ fontSize: 48, color: "var(--mantine-color-blue-5)" }}
              />
              <Text size="lg" fw={600}>
                {t("pdfTextEditor.empty.title", "No document loaded")}
              </Text>
              <Text size="sm" c="dimmed" ta="center" maw={420}>
                {activeFiles.length > 0
                  ? t(
                      "pdfTextEditor.empty.dropzoneWithFiles",
                      "Select a file from the Files tab, or drag and drop a PDF here, or click to browse",
                    )
                  : t(
                      "pdfTextEditor.empty.dropzone",
                      "Drag and drop a PDF here, or click to browse",
                    )}
              </Text>
            </Stack>
          </Dropzone>
        </Stack>
      )}

      {isConverting && (
        <Card withBorder radius="md" padding="xl" style={{ flex: 1 }}>
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <div style={{ flex: 1 }}>
                <Text size="lg" fw={600} mb="xs">
                  {conversionProgress
                    ? conversionProgress.message
                    : t(
                        "pdfTextEditor.converting",
                        "Converting PDF to editable format...",
                      )}
                </Text>
                {conversionProgress && (
                  <Group gap="xs">
                    <Text size="sm" c="dimmed" tt="capitalize">
                      {t(
                        `pdfTextEditor.stages.${conversionProgress.stage}`,
                        conversionProgress.stage,
                      )}
                    </Text>
                    {conversionProgress.current !== undefined &&
                      conversionProgress.total !== undefined && (
                        <Text size="sm" c="dimmed">
                          {t("ui.pageLabel") + " "}
                          {conversionProgress.current} of{" "}
                          {conversionProgress.total}
                        </Text>
                      )}
                  </Group>
                )}
              </div>
              <AutorenewIcon sx={{ fontSize: 36 }} className="animate-spin" />
            </Group>
            <Progress
              value={conversionProgress?.percent || 0}
              size="lg"
              radius="md"
            />
          </Stack>
        </Card>
      )}

      {hasDocument && !isConverting && (
        <Stack
          gap="lg"
          className="flex-1"
          style={{
            minHeight: 0,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <Text fw={500}>
                {t(
                  "pdfTextEditor.pageSummary",
                  "Page {{number}} of {{total}}",
                  {
                    number: selectedPage + 1,
                    total: pages.length,
                  },
                )}
              </Text>
              {dirtyPages[selectedPage] && (
                <Badge color="yellow" size="xs">
                  {t("pdfTextEditor.badges.modified", "Edited")}
                </Badge>
              )}
              <Badge color="blue" variant="dot" size="xs">
                {t("pdfTextEditor.badges.earlyAccess", "Early Access")}
              </Badge>
            </Group>
            {pages.length > 1 && (
              <Pagination
                value={selectedPage + 1}
                onChange={handlePageChange}
                total={pages.length}
                size="sm"
              />
            )}
          </Group>

          <Alert
            variant="light"
            color="blue"
            radius="md"
            py={6}
            icon={<InfoOutlinedIcon fontSize="small" />}
          >
            <Text size="xs">
              {editorMode === "redact"
                ? t(
                    "pdfTextEditor.hint.redact",
                    "Drag across the page to cover an area (logo, watermark, sensitive text). Switch back to Select to edit text and images.",
                  )
                : editorMode === "text"
                  ? t(
                      "pdfTextEditor.hint.text",
                      "Click anywhere on the page to drop a new text box, then type. Use the corner handle to widen it.",
                    )
                  : t(
                      "pdfTextEditor.hint.line",
                      "Click text to edit · drag to move · resize from the corner · ✗ to delete · Ctrl/Cmd-click to select several",
                    )}
            </Text>
          </Alert>

          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Button.Group>
                <Tooltip
                  label={t("pdfTextEditor.history.undo", "Undo (Ctrl/Cmd+Z)")}
                >
                  <Button
                    size="compact-sm"
                    variant="default"
                    disabled={!canUndo}
                    onClick={onUndo}
                    aria-label={t("pdfTextEditor.history.undo", "Undo")}
                    leftSection={<UndoIcon sx={{ fontSize: 16 }} />}
                  >
                    {t("pdfTextEditor.history.undoShort", "Undo")}
                  </Button>
                </Tooltip>
                <Tooltip
                  label={t(
                    "pdfTextEditor.history.redo",
                    "Redo (Ctrl/Cmd+Shift+Z)",
                  )}
                >
                  <Button
                    size="compact-sm"
                    variant="default"
                    disabled={!canRedo}
                    onClick={onRedo}
                    aria-label={t("pdfTextEditor.history.redo", "Redo")}
                    leftSection={<RedoIcon sx={{ fontSize: 16 }} />}
                  >
                    {t("pdfTextEditor.history.redoShort", "Redo")}
                  </Button>
                </Tooltip>
              </Button.Group>
              <Text size="xs" c="dimmed">
                {t("pdfTextEditor.palette.tools", "Tools")}
              </Text>
              <Button.Group>
                <Tooltip
                  label={t("pdfTextEditor.palette.select", "Select & edit")}
                >
                  <Button
                    size="compact-sm"
                    variant={editorMode === "select" ? "filled" : "default"}
                    onClick={() => setEditorMode("select")}
                    leftSection={<NearMeOutlinedIcon sx={{ fontSize: 16 }} />}
                  >
                    {t("pdfTextEditor.palette.select", "Select & edit")}
                  </Button>
                </Tooltip>
                <Tooltip
                  label={t(
                    "pdfTextEditor.palette.redact",
                    "Cover an area (redact)",
                  )}
                >
                  <Button
                    size="compact-sm"
                    variant={editorMode === "redact" ? "filled" : "default"}
                    onClick={() => setEditorMode("redact")}
                    leftSection={<CropSquareIcon sx={{ fontSize: 16 }} />}
                  >
                    {t("pdfTextEditor.palette.redact", "Cover area")}
                  </Button>
                </Tooltip>
                <Tooltip label={t("pdfTextEditor.palette.addText", "Add text")}>
                  <Button
                    size="compact-sm"
                    variant={editorMode === "text" ? "filled" : "default"}
                    onClick={() => setEditorMode("text")}
                    leftSection={<TextFieldsIcon sx={{ fontSize: 16 }} />}
                  >
                    {t("pdfTextEditor.palette.addText", "Add text")}
                  </Button>
                </Tooltip>
                <Tooltip
                  label={t(
                    "pdfTextEditor.palette.objectsTooltip",
                    "Vector objects (experimental)",
                  )}
                >
                  <Button
                    size="compact-sm"
                    variant={editorMode === "objects" ? "filled" : "default"}
                    onClick={() => {
                      setEditorMode("objects");
                      onRequestVectorPaths(selectedPage);
                    }}
                    leftSection={<TimelineOutlinedIcon sx={{ fontSize: 16 }} />}
                  >
                    {t("pdfTextEditor.palette.objects", "Objects")}
                  </Button>
                </Tooltip>
              </Button.Group>
              <Tooltip
                label={t("pdfTextEditor.palette.addImage", "Add an image")}
              >
                <Button
                  size="compact-sm"
                  variant="default"
                  leftSection={<ImageOutlinedIcon sx={{ fontSize: 16 }} />}
                  onClick={() => addImageInputRef.current?.click()}
                >
                  {t("pdfTextEditor.palette.addImage", "Add image")}
                </Button>
              </Tooltip>
            </Group>
            {editorMode === "redact" && (
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {t("pdfTextEditor.palette.color", "Colour")}
                </Text>
                {["#ffffff", "#000000"].map((swatch) => (
                  <Tooltip
                    key={swatch}
                    label={
                      swatch === "#ffffff"
                        ? t("pdfTextEditor.palette.white", "White")
                        : t("pdfTextEditor.palette.black", "Black")
                    }
                  >
                    <Box
                      role="button"
                      aria-label={swatch}
                      onClick={() => setRedactionColor(swatch)}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        cursor: "pointer",
                        backgroundColor: swatch,
                        border:
                          redactionColor === swatch
                            ? "2px solid var(--mantine-color-blue-5)"
                            : "1px solid var(--mantine-color-gray-4)",
                      }}
                    />
                  </Tooltip>
                ))}
              </Group>
            )}
            {editorMode === "objects" && (
              <Text size="xs" c="dimmed">
                {vectorPathsLoadingPage !== null
                  ? t(
                      "pdfTextEditor.palette.objectsLoading",
                      "Scanning page for vector objects...",
                    )
                  : t(
                      "pdfTextEditor.palette.objectsHint",
                      "Click an outlined object, then the ✗ to remove it.",
                    )}
              </Text>
            )}
            {showTextStyleControls && (
              <Group gap={8} wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {activeAddedGroup
                    ? t(
                        "pdfTextEditor.palette.textStyleActive",
                        "Selected text",
                      )
                    : t("pdfTextEditor.palette.textStyleNew", "New text")}
                </Text>
                <NumberInput
                  size="xs"
                  w={92}
                  min={ADD_TEXT_MIN_FONT_SIZE}
                  max={ADD_TEXT_MAX_FONT_SIZE}
                  step={1}
                  value={Math.round(addTextFontSizeValue)}
                  onChange={handleAddTextFontSizeChange}
                  aria-label={t("pdfTextEditor.palette.fontSize", "Font size")}
                  suffix=" pt"
                />
                <ColorInput
                  size="xs"
                  w={132}
                  format="hex"
                  withEyeDropper={false}
                  value={addTextColorValue}
                  onChange={handleAddTextColorChange}
                  aria-label={t(
                    "pdfTextEditor.palette.fontColor",
                    "Text colour",
                  )}
                  swatches={[
                    "#000000",
                    "#ffffff",
                    "#e03131",
                    "#1971c2",
                    "#2f9e44",
                    "#f08c00",
                    "#6741d9",
                  ]}
                />
                <Button.Group>
                  <Tooltip label={t("pdfTextEditor.palette.bold", "Bold")}>
                    <Button
                      size="compact-sm"
                      variant={addTextBoldValue ? "filled" : "default"}
                      onClick={handleAddTextBoldToggle}
                      aria-label={t("pdfTextEditor.palette.bold", "Bold")}
                      aria-pressed={addTextBoldValue}
                    >
                      <FormatBoldIcon sx={{ fontSize: 16 }} />
                    </Button>
                  </Tooltip>
                  <Tooltip label={t("pdfTextEditor.palette.italic", "Italic")}>
                    <Button
                      size="compact-sm"
                      variant={addTextItalicValue ? "filled" : "default"}
                      onClick={handleAddTextItalicToggle}
                      aria-label={t("pdfTextEditor.palette.italic", "Italic")}
                      aria-pressed={addTextItalicValue}
                    >
                      <FormatItalicIcon sx={{ fontSize: 16 }} />
                    </Button>
                  </Tooltip>
                </Button.Group>
              </Group>
            )}
          </Group>

          <input
            ref={addImageInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAddImageChange}
          />

          <Modal
            opened={showWelcomeBanner}
            onClose={handleDismissWelcomeBanner}
            title={
              <Group gap="xs">
                <InfoOutlinedIcon fontSize="small" />
                <Text fw={600}>
                  {t(
                    "pdfTextEditor.welcomeBanner.title",
                    "Welcome to the PDF Editor (Early Access)",
                  )}
                </Text>
              </Group>
            }
            centered
            size="lg"
            scrollAreaComponent={Box}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: "70vh",
                width: "100%",
              }}
            >
              {/* Header (fixed) */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                <Alert color="orange" variant="light" radius="md">
                  <Text size="sm" fw={500}>
                    {t(
                      "pdfTextEditor.welcomeBanner.experimental",
                      "This is an experimental feature in active development. Expect some instability and issues during use.",
                    )}
                  </Text>
                </Alert>
                <Text size="sm">
                  {t(
                    "pdfTextEditor.welcomeBanner.howItWorks",
                    "This tool converts your PDF to an editable format where you can modify text content and reposition images. Changes are saved back as a new PDF.",
                  )}
                </Text>
              </div>

              {/* Body (scrollable) */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  paddingRight: "0.25rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <Divider />
                  <Text size="sm" fw={500} c="green.7">
                    {t(
                      "pdfTextEditor.welcomeBanner.bestFor",
                      "Works Best With:",
                    )}
                  </Text>
                  <Text
                    size="sm"
                    component="ul"
                    style={{ marginLeft: "1rem", marginTop: "0.25rem" }}
                  >
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.bestFor1",
                        "Simple PDFs containing primarily text and images",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.bestFor2",
                        "Documents with standard paragraph formatting",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.bestFor3",
                        "Letters, essays, reports, and basic documents",
                      )}
                    </li>
                  </Text>
                  <Divider />
                  <Text size="sm" fw={500} c="orange.7">
                    {t(
                      "pdfTextEditor.welcomeBanner.notIdealFor",
                      "Not Ideal For:",
                    )}
                  </Text>
                  <Text
                    size="sm"
                    component="ul"
                    style={{ marginLeft: "1rem", marginTop: "0.25rem" }}
                  >
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.notIdealFor1",
                        "PDFs with special formatting like bullet points, tables, or multi-column layouts",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.notIdealFor2",
                        "Magazines, brochures, or heavily designed documents",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.notIdealFor3",
                        "Instruction manuals with complex layouts",
                      )}
                    </li>
                  </Text>
                  <Divider />
                  <Text size="sm" fw={500}>
                    {t(
                      "pdfTextEditor.welcomeBanner.limitations",
                      "Current Limitations:",
                    )}
                  </Text>
                  <Text
                    size="sm"
                    component="ul"
                    style={{ marginLeft: "1rem", marginTop: "0.25rem" }}
                  >
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.limitation1",
                        "Font rendering may differ slightly from the original PDF",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.limitation2",
                        "Complex graphics, form fields, and annotations are preserved but not editable",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.limitation3",
                        "Large files may take time to convert and process",
                      )}
                    </li>
                  </Text>
                  <Divider />
                  <Text size="sm" fw={500}>
                    {t(
                      "pdfTextEditor.welcomeBanner.knownIssues",
                      "Known Issues (Being Fixed):",
                    )}
                  </Text>
                  <Text
                    size="sm"
                    component="ul"
                    style={{ marginLeft: "1rem", marginTop: "0.25rem" }}
                  >
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.issue1",
                        "Text colour is not currently preserved (will be added soon)",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.issue2",
                        "Paragraph mode has more alignment and spacing issues - Single Line mode recommended",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.issue3",
                        "The preview display differs from the exported PDF - exported PDFs are closer to the original",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.issue4",
                        "Rotated text alignment may need manual adjustment",
                      )}
                    </li>
                    <li>
                      {t(
                        "pdfTextEditor.welcomeBanner.issue5",
                        "Transparency and layering effects may vary from original",
                      )}
                    </li>
                  </Text>
                </div>
              </div>

              {/* Footer (fixed) */}
              <div
                style={{
                  marginTop: "0.75rem",
                }}
              >
                <Divider />
                <Text size="xs" c="dimmed" mt="xs">
                  {t(
                    "pdfTextEditor.welcomeBanner.feedback",
                    "This is an early access feature. Please report any issues you encounter to help us improve!",
                  )}
                </Text>
                <Group justify="flex-end" gap="sm" mt="xs">
                  <Button
                    variant="default"
                    onClick={handleDismissWelcomeBanner}
                  >
                    {t("pdfTextEditor.welcomeBanner.gotIt", "Got it")}
                  </Button>
                  <Button onClick={handleDontShowAgain}>
                    {t(
                      "pdfTextEditor.welcomeBanner.dontShowAgain",
                      "Don't show again",
                    )}
                  </Button>
                </Group>
              </div>
            </div>
          </Modal>

          <Card
            withBorder
            padding="md"
            radius="md"
            shadow="xs"
            style={{
              flex: 1,
              minHeight: 0,
              height: "100%",
              overflow: "hidden",
            }}
          >
            <ScrollArea
              style={{ height: "100%", maxHeight: "100%" }}
              offsetScrollbars
            >
              <Box
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "flex-start",
                  width: "100%",
                  minHeight: "100%",
                }}
              >
                <Box
                  style={{
                    background: "#f3f4f6",
                    padding: "0.5rem",
                    borderRadius: "0.75rem",
                  }}
                  onClick={handleBackgroundClick}
                >
                  <Box
                    style={{
                      position: "relative",
                      width: `${scaledWidth}px`,
                      height: `${scaledHeight}px`,
                      backgroundColor: "#ffffff",
                      boxShadow: "0 0 12px rgba(15, 23, 42, 0.12)",
                      borderRadius: "0.5rem",
                      overflow: "hidden",
                    }}
                    ref={(node) => {
                      containerRef.current = node;
                      if (node) {
                        console.log(`🖼️ [PdfTextEditor] Canvas Rendered:`, {
                          renderedWidth: node.offsetWidth,
                          renderedHeight: node.offsetHeight,
                          styleWidth: scaledWidth,
                          styleHeight: scaledHeight,
                          pageNumber: selectedPage + 1,
                        });
                      }
                    }}
                  >
                    {pagePreview && (
                      <img
                        src={pagePreview}
                        alt={t("pdfTextEditor.pagePreviewAlt", "Page preview")}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          pointerEvents: "none",
                          userSelect: "none",
                          zIndex: 0,
                        }}
                      />
                    )}
                    {editorMode === "redact" && (
                      <Box
                        onMouseDown={handleRedactionPointerDown}
                        onMouseMove={handleRedactionPointerMove}
                        onMouseUp={handleRedactionPointerUp}
                        onMouseLeave={handleRedactionPointerUp}
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 4_000_000,
                          cursor: "crosshair",
                        }}
                      >
                        {redactionDraft && (
                          <Box
                            style={{
                              position: "absolute",
                              left: `${redactionDraft.left}px`,
                              top: `${redactionDraft.top}px`,
                              width: `${redactionDraft.width}px`,
                              height: `${redactionDraft.height}px`,
                              backgroundColor: redactionColor,
                              opacity: 0.55,
                              border: "1px dashed var(--mantine-color-blue-5)",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                      </Box>
                    )}
                    {editorMode === "text" && (
                      <Box
                        onMouseDown={handleTextPlacePointerDown}
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 4_000_000,
                          cursor: "text",
                        }}
                      />
                    )}
                    {selectionToolbarPosition && (
                      <Group
                        gap={6}
                        style={{
                          position: "absolute",
                          left: `${selectionToolbarPosition.left}px`,
                          top: `${selectionToolbarPosition.top}px`,
                          zIndex: 3_000_000,
                          backgroundColor: "rgba(15, 23, 42, 0.92)",
                          borderRadius: 999,
                          padding: "4px 8px",
                          boxShadow: "0 4px 16px rgba(15, 23, 42, 0.45)",
                          pointerEvents: "auto",
                        }}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        {canMergeSelection && (
                          <Tooltip
                            label={t(
                              "pdfTextEditor.manual.mergeTooltip",
                              "Merge selected boxes",
                            )}
                          >
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="blue"
                              aria-label={t(
                                "pdfTextEditor.manual.merge",
                                "Merge selection",
                              )}
                              onClick={handleMergeSelection}
                            >
                              <MergeTypeIcon fontSize="small" />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {canUngroupSelection && (
                          <Tooltip
                            label={t(
                              "pdfTextEditor.manual.ungroupTooltip",
                              "Split paragraph back into lines",
                            )}
                          >
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="blue"
                              aria-label={t(
                                "pdfTextEditor.manual.ungroup",
                                "Ungroup selection",
                              )}
                              onClick={handleUngroupSelection}
                            >
                              <CallSplitIcon fontSize="small" />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <Menu
                          withinPortal
                          position="bottom-end"
                          shadow="md"
                          disabled={!hasSelection && !hasWidthOverrides}
                        >
                          <Menu.Target>
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="blue"
                              aria-label={t(
                                "pdfTextEditor.manual.widthMenu",
                                "Width options",
                              )}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreVertIcon fontSize="small" />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              disabled={!hasSelection}
                              onClick={() => handleWidthAdjustment("expand")}
                            >
                              {t(
                                "pdfTextEditor.manual.expandWidth",
                                "Expand to page edge",
                              )}
                            </Menu.Item>
                            <Menu.Item
                              disabled={!hasWidthOverrides}
                              onClick={() => handleWidthAdjustment("reset")}
                            >
                              {t(
                                "pdfTextEditor.manual.resetWidth",
                                "Reset width",
                              )}
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    )}
                    {orderedImages.map((image, imageIndex) => {
                      if (!image?.imageData) {
                        return null;
                      }
                      const bounds = getImageBounds(image);
                      const width = Math.max(bounds.right - bounds.left, 1);
                      const height = Math.max(bounds.top - bounds.bottom, 1);
                      const cssWidth = Math.max(width * scale, 2);
                      const cssHeight = Math.max(height * scale, 2);
                      const cssLeft = bounds.left * scale;
                      const cssTop = (pageHeight - bounds.top) * scale;
                      const imageId =
                        image.id ?? `page-${selectedPage}-image-${imageIndex}`;
                      const isActive = activeImageId === imageId;
                      const isRedaction =
                        imageId.startsWith("aziral-redaction-");
                      const src = `data:image/${image.imageFormat ?? "png"};base64,${image.imageData}`;
                      const baseZIndex =
                        (image.zOrder ?? -1_000_000) + 1_050_000;
                      // A full-bleed ORIGINAL image is the page background. It
                      // stays BAKED into the page preview (requestPagePreview
                      // does not erase it), so we must NOT also render it as a
                      // movable overlay — that overlay is what kept "replacing"
                      // the background. Skip it entirely: the background then
                      // looks exactly like the source PDF and is never swapped.
                      // (Redaction / user-added aziral-* layers are never
                      // treated as background.) Export is unaffected — it
                      // rebuilds from the model, which still holds the image.
                      const pageCoverage =
                        (width * height) / Math.max(pageWidth * pageHeight, 1);
                      const isBackgroundImage =
                        !imageId.startsWith("aziral-") && pageCoverage >= 0.9;
                      if (isBackgroundImage) {
                        return null;
                      }
                      // Boost above the text layer only while the image is
                      // actually being dragged/resized — NOT on mere hover.
                      // Hover-boosting let a hovered image cover others.
                      const isDraggingImage =
                        draggingImageRef.current === imageId;
                      const zIndex = isDraggingImage
                        ? baseZIndex + 1_000_000
                        : baseZIndex;

                      return (
                        <Rnd
                          ref={(ref) => {
                            if (ref) {
                              rndRefs.current.set(imageId, ref);
                            } else {
                              rndRefs.current.delete(imageId);
                            }
                          }}
                          key={`image-${imageId}`}
                          bounds="parent"
                          size={{ width: cssWidth, height: cssHeight }}
                          position={{ x: cssLeft, y: cssTop }}
                          onDragStart={(_event, _data) => {
                            setActiveGroupId(null);
                            setEditingGroupId(null);
                            setActiveImageId(imageId);
                            draggingImageRef.current = imageId;
                          }}
                          onDrag={(_event, data) => {
                            // Cancel any pending update
                            if (pendingDragUpdateRef.current) {
                              cancelAnimationFrame(
                                pendingDragUpdateRef.current,
                              );
                            }

                            // Schedule update on next frame to batch rapid drag events
                            pendingDragUpdateRef.current =
                              requestAnimationFrame(() => {
                                const rndRef = rndRefs.current.get(imageId);
                                if (rndRef && rndRef.updatePosition) {
                                  rndRef.updatePosition({
                                    x: data.x,
                                    y: data.y,
                                  });
                                }
                              });
                          }}
                          onDragStop={(_event, data) => {
                            if (pendingDragUpdateRef.current) {
                              cancelAnimationFrame(
                                pendingDragUpdateRef.current,
                              );
                              pendingDragUpdateRef.current = null;
                            }
                            draggingImageRef.current = null;
                            emitImageTransform(
                              imageId,
                              data.x,
                              data.y,
                              cssWidth,
                              cssHeight,
                            );
                          }}
                          onResizeStart={() => {
                            setActiveImageId(imageId);
                            setActiveGroupId(null);
                            setEditingGroupId(null);
                            draggingImageRef.current = imageId;
                          }}
                          onResizeStop={(
                            _event,
                            _direction,
                            ref,
                            _delta,
                            position,
                          ) => {
                            draggingImageRef.current = null;
                            const nextWidth = parseFloat(ref.style.width);
                            const nextHeight = parseFloat(ref.style.height);
                            emitImageTransform(
                              imageId,
                              position.x,
                              position.y,
                              nextWidth,
                              nextHeight,
                            );
                          }}
                          style={{ zIndex }}
                        >
                          <Box
                            onMouseEnter={() => setActiveImageId(imageId)}
                            onMouseLeave={() => {
                              setActiveImageId((current) =>
                                current === imageId ? null : current,
                              );
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              onImageReset(selectedPage, imageId);
                            }}
                            style={{
                              width: "100%",
                              height: "100%",
                              cursor: isActive ? "grabbing" : "grab",
                              outline: isActive
                                ? "2px solid rgba(59, 130, 246, 0.9)"
                                : "1px solid rgba(148, 163, 184, 0.4)",
                              outlineOffset: "-1px",
                              borderRadius: 4,
                              backgroundColor: "rgba(255,255,255,0.04)",
                              transition: "outline 120ms ease",
                            }}
                          >
                            <img
                              src={src}
                              alt={t(
                                "pdfTextEditor.imageLabel",
                                "Placed image",
                              )}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: isRedaction ? "fill" : "contain",
                                pointerEvents: "none",
                                userSelect: "none",
                              }}
                            />
                            {isActive && (
                              <Tooltip
                                label={t(
                                  "pdfTextEditor.image.delete",
                                  "Delete image",
                                )}
                                withinPortal
                              >
                                <ActionIcon
                                  size="sm"
                                  color="red"
                                  variant="filled"
                                  radius="xl"
                                  aria-label={t(
                                    "pdfTextEditor.image.delete",
                                    "Delete image",
                                  )}
                                  style={{
                                    position: "absolute",
                                    top: -10,
                                    right: -10,
                                    zIndex: 5,
                                  }}
                                  onMouseDown={(event) =>
                                    event.stopPropagation()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveImageId((current) =>
                                      current === imageId ? null : current,
                                    );
                                    onImageDelete(selectedPage, imageId);
                                  }}
                                >
                                  <CloseIcon sx={{ fontSize: 14 }} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Box>
                        </Rnd>
                      );
                    })}
                    {editorMode === "objects" &&
                      pageVectorPaths.map((path, pathIndex) => {
                        if (path.deleted === true) {
                          return null;
                        }
                        const bounds = getVectorPathBounds(path);
                        const width = Math.max(bounds.right - bounds.left, 1);
                        const height = Math.max(bounds.top - bounds.bottom, 1);
                        const cssWidth = Math.max(width * scale, 2);
                        const cssHeight = Math.max(height * scale, 2);
                        const cssLeft = bounds.left * scale;
                        const cssTop = (pageHeight - bounds.top) * scale;
                        const pathId =
                          path.id ?? `page-${selectedPage}-vector-${pathIndex}`;
                        const isActive = activeVectorPathId === pathId;

                        return (
                          <Box
                            key={`vector-${pathId}`}
                            onMouseEnter={() => setActiveVectorPathId(pathId)}
                            onMouseLeave={() => {
                              setActiveVectorPathId((current) =>
                                current === pathId ? null : current,
                              );
                            }}
                            onClick={() => setActiveVectorPathId(pathId)}
                            style={{
                              position: "absolute",
                              left: cssLeft,
                              top: cssTop,
                              width: cssWidth,
                              height: cssHeight,
                              cursor: "pointer",
                              outline: isActive
                                ? "2px solid rgba(59, 130, 246, 0.9)"
                                : "1px dashed rgba(234, 88, 12, 0.6)",
                              outlineOffset: "-1px",
                              borderRadius: 2,
                              backgroundColor: isActive
                                ? "rgba(59, 130, 246, 0.08)"
                                : "transparent",
                              transition: "outline 120ms ease",
                              zIndex: 1_090_000 + pathIndex,
                            }}
                          >
                            {isActive && (
                              <Tooltip
                                label={t(
                                  "pdfTextEditor.vectorObject.delete",
                                  "Delete object",
                                )}
                                withinPortal
                              >
                                <ActionIcon
                                  size="sm"
                                  color="red"
                                  variant="filled"
                                  radius="xl"
                                  aria-label={t(
                                    "pdfTextEditor.vectorObject.delete",
                                    "Delete object",
                                  )}
                                  style={{
                                    position: "absolute",
                                    top: -10,
                                    right: -10,
                                    zIndex: 5,
                                  }}
                                  onMouseDown={(event) =>
                                    event.stopPropagation()
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveVectorPathId(null);
                                    onVectorPathDelete(selectedPage, pathId);
                                  }}
                                >
                                  <CloseIcon sx={{ fontSize: 14 }} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Box>
                        );
                      })}
                    {visibleGroups.length === 0 &&
                    orderedImages.length === 0 ? (
                      <Group
                        justify="center"
                        align="center"
                        style={{ height: "100%" }}
                      >
                        <Stack gap={4} align="center">
                          <Text size="sm" c="dimmed">
                            {t(
                              "pdfTextEditor.noTextOnPage",
                              "No editable text was detected on this page.",
                            )}
                          </Text>
                        </Stack>
                      </Group>
                    ) : (
                      visibleGroups.map(({ group, pageGroupIndex }) => {
                        const bounds = toCssBounds(
                          currentPage,
                          pageHeight,
                          scale,
                          group.bounds,
                        );
                        const changed = group.text !== group.originalText;
                        const isActive =
                          activeGroupId === group.id ||
                          editingGroupId === group.id;
                        const isEditing = editingGroupId === group.id;
                        const baseFontSize =
                          group.fontMatrixSize ?? group.fontSize ?? 12;
                        const fontSizePx = Math.max(baseFontSize * scale, 6);
                        const effectiveFontId =
                          resolveFontIdForIndex(pageGroupIndex) ?? group.fontId;
                        const fontFamily = getFontFamily(
                          effectiveFontId,
                          group.pageIndex,
                        );
                        let lineHeightPx = getLineHeightPx(
                          effectiveFontId,
                          group.pageIndex,
                          fontSizePx,
                        );
                        let lineHeightRatio =
                          fontSizePx > 0
                            ? Math.max(lineHeightPx / fontSizePx, 1.05)
                            : 1.2;
                        const rotation = group.rotation ?? 0;
                        const hasRotation = Math.abs(rotation) > 0.5;
                        const baselineLength =
                          group.baselineLength ??
                          Math.max(group.bounds.right - group.bounds.left, 0);
                        const geometry = getFontGeometry(
                          effectiveFontId,
                          group.pageIndex,
                        );
                        const ascentPx = geometry
                          ? Math.max(
                              fontSizePx * geometry.ascentRatio,
                              fontSizePx * 0.7,
                            )
                          : fontSizePx * 0.82;
                        const descentPx = geometry
                          ? Math.max(
                              fontSizePx * geometry.descentRatio,
                              fontSizePx * 0.2,
                            )
                          : fontSizePx * 0.22;
                        lineHeightPx = Math.max(
                          lineHeightPx,
                          ascentPx + descentPx,
                        );
                        if (fontSizePx > 0) {
                          lineHeightRatio = Math.max(
                            lineHeightRatio,
                            lineHeightPx / fontSizePx,
                          );
                        }
                        const detectedSpacingPx =
                          group.lineSpacing && group.lineSpacing > 0
                            ? group.lineSpacing * scale
                            : undefined;
                        if (detectedSpacingPx && detectedSpacingPx > 0) {
                          lineHeightPx = Math.max(
                            lineHeightPx,
                            detectedSpacingPx,
                          );
                          if (fontSizePx > 0) {
                            lineHeightRatio = Math.max(
                              lineHeightRatio,
                              detectedSpacingPx / fontSizePx,
                            );
                          }
                        }
                        const lineCount = Math.max(
                          group.text.split("\n").length,
                          1,
                        );
                        const paragraphHeightPx =
                          lineCount > 1
                            ? lineHeightPx +
                              (lineCount - 1) *
                                (detectedSpacingPx ?? lineHeightPx)
                            : lineHeightPx;

                        let containerLeft = bounds.left;
                        let containerTop = bounds.top;
                        const {
                          width: resolvedWidth,
                          base: baseWidth,
                          max: _maxWidth,
                        } = resolveGroupWidth(group);
                        let containerWidth = Math.max(
                          resolvedWidth * scale,
                          fontSizePx,
                        );
                        let containerHeight = Math.max(
                          bounds.height,
                          paragraphHeightPx,
                        );
                        let transform: string | undefined;
                        let transformOrigin: React.CSSProperties["transformOrigin"];

                        if (hasRotation) {
                          const anchorX = group.anchor?.x ?? group.bounds.left;
                          const anchorY =
                            group.anchor?.y ?? group.bounds.bottom;
                          containerLeft = anchorX * scale;
                          const anchorTop =
                            Math.max(pageHeight - anchorY, 0) * scale;
                          containerWidth = Math.max(
                            baselineLength * scale,
                            MIN_BOX_SIZE,
                          );
                          containerHeight = Math.max(
                            lineHeightPx,
                            fontSizePx * lineHeightRatio,
                          );
                          transformOrigin = "left bottom";
                          // Negate rotation because Y-axis is flipped from PDF to web coordinates
                          transform = `rotate(${-rotation}deg)`;
                          // Align the baseline (PDF anchor) with the bottom edge used as the
                          // transform origin. Without this adjustment rotated text appears shifted
                          // downward by roughly one line height.
                          containerTop = anchorTop - containerHeight;
                        }

                        if (
                          lineCount === 1 &&
                          !hasRotation &&
                          group.baseline !== null &&
                          group.baseline !== undefined &&
                          geometry
                        ) {
                          const cssBaselineTop =
                            (pageHeight - group.baseline) * scale;
                          containerTop = Math.max(cssBaselineTop - ascentPx, 0);
                          containerHeight = Math.max(
                            containerHeight,
                            ascentPx + descentPx,
                          );
                        }

                        // Extract styling from group
                        const textColor = group.color || "#111827";
                        // When the backend could not extract a fill colour we
                        // fall back to a dark default that is invisible on a
                        // dark page. Paint a light chip directly behind the
                        // glyphs (same idea the edit field already uses) so the
                        // overlay text stays readable on ANY background. This is
                        // an editor-only viewing aid — export uses the original
                        // colour, never this.
                        const unknownColor = !group.color;
                        const legibilityChip: React.CSSProperties = unknownColor
                          ? {
                              backgroundColor: "rgba(255,255,255,0.92)",
                              borderRadius: 2,
                              boxDecorationBreak: "clone",
                              WebkitBoxDecorationBreak: "clone",
                            }
                          : {};
                        const fontWeight =
                          group.fontWeight ||
                          getFontWeight(effectiveFontId, group.pageIndex);
                        // Added-text boxes can carry an italic Noto fallback;
                        // mirror it in the editor preview (synthesised by the
                        // browser on the fallback family — export uses the real
                        // NotoSans italic glyphs).
                        const fontStyle: React.CSSProperties["fontStyle"] =
                          addedTextFontStyleFlags(group.fontId).italic
                            ? "italic"
                            : "normal";

                        // Determine text wrapping behavior based on whether text has been changed
                        const hasChanges = changed;
                        const widthExtended = resolvedWidth - baseWidth > 0.5;
                        // Only enable wrapping if:
                        // 1. It's paragraph layout (multi-line groups should wrap)
                        // 2. Width was manually extended (user explicitly made space for wrapping)
                        // 3. Has changes AND was already wrapping (preserve existing wrap state)
                        // DO NOT enable wrapping just because isEditing - text should only wrap when it actually overflows
                        const wasWrapping = isParagraphLayout || widthExtended;
                        const enableWrap =
                          wasWrapping || (hasChanges && wasWrapping);
                        const whiteSpace = enableWrap ? "pre-wrap" : "pre";
                        const wordBreak = enableWrap ? "break-word" : "normal";
                        const overflowWrap = enableWrap
                          ? "break-word"
                          : "normal";

                        // For paragraph mode, allow height to grow to accommodate lines without wrapping
                        // For single-line mode, maintain fixed height based on PDF bounds
                        const useFlexibleHeight =
                          enableWrap || (isParagraphLayout && lineCount > 1);

                        // The renderGroupContainer wrapper adds 4px horizontal padding (2px left + 2px right)
                        // We need to add this to the container width to compensate, so the inner content
                        // has the full PDF-defined width available for text
                        const WRAPPER_HORIZONTAL_PADDING = 4;

                        // Live drag-to-move offset (CSS px) while the move handle is held.
                        const moveOffset = moveDraft.get(group.id);
                        if (moveOffset) {
                          containerLeft += moveOffset.dx;
                          containerTop += moveOffset.dy;
                        }

                        const containerStyle: React.CSSProperties = {
                          position: "absolute",
                          left: `${containerLeft}px`,
                          top: `${containerTop}px`,
                          width: `${containerWidth + WRAPPER_HORIZONTAL_PADDING}px`,
                          height: useFlexibleHeight
                            ? "auto"
                            : `${containerHeight}px`,
                          minHeight: useFlexibleHeight
                            ? "auto"
                            : `${containerHeight}px`,
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "flex-start",
                          pointerEvents: "auto",
                          cursor: "text",
                          zIndex: 2_000_000,
                          transform,
                          transformOrigin,
                        };

                        const showResizeHandle =
                          !hasRotation &&
                          (selectedGroupIds.has(group.id) ||
                            activeGroupId === group.id);
                        const resizeHandle = showResizeHandle ? (
                          <Box
                            role="button"
                            aria-label={t(
                              "pdfTextEditor.manual.resizeHandle",
                              "Adjust text width",
                            )}
                            onMouseDown={(event) =>
                              handleResizeStart(event, group, resolvedWidth)
                            }
                            style={{
                              position: "absolute",
                              top: "50%",
                              right: -6,
                              width: 12,
                              height: 32,
                              marginTop: -16,
                              cursor: "ew-resize",
                              borderRadius: 6,
                              backgroundColor: "rgba(76, 110, 245, 0.35)",
                              border: "1px solid rgba(76, 110, 245, 0.8)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "white",
                              fontSize: 9,
                              userSelect: "none",
                            }}
                          >
                            ||
                          </Box>
                        ) : null;

                        const fontScaleHandle =
                          showResizeHandle &&
                          isAddedTextFontId(group.fontId) ? (
                            <Box
                              role="button"
                              aria-label={t(
                                "pdfTextEditor.manual.fontScaleHandle",
                                "Drag to resize text",
                              )}
                              onMouseDown={(event) =>
                                handleFontScaleStart(event, group)
                              }
                              style={{
                                position: "absolute",
                                bottom: -7,
                                right: -7,
                                width: 14,
                                height: 14,
                                cursor: "nwse-resize",
                                borderRadius: 7,
                                backgroundColor: "rgba(76, 110, 245, 0.5)",
                                border: "1px solid rgba(76, 110, 245, 0.9)",
                                userSelect: "none",
                              }}
                            />
                          ) : null;

                        const groupHandles =
                          resizeHandle || fontScaleHandle ? (
                            <>
                              {resizeHandle}
                              {fontScaleHandle}
                            </>
                          ) : null;

                        if (isEditing) {
                          return (
                            <Box key={group.id} style={containerStyle}>
                              {renderGroupContainer(
                                group.id,
                                group.pageIndex,
                                true,
                                changed,
                                <div
                                  ref={(node) => {
                                    if (node) {
                                      editorRefs.current.set(group.id, node);
                                    } else {
                                      editorRefs.current.delete(group.id);
                                    }
                                  }}
                                  contentEditable
                                  suppressContentEditableWarning
                                  data-editor-group={group.id}
                                  onCompositionStart={() =>
                                    handleCompositionStart(group.id)
                                  }
                                  onCompositionEnd={(event) =>
                                    handleCompositionEnd(
                                      event.currentTarget,
                                      group.pageIndex,
                                      group.id,
                                    )
                                  }
                                  onFocus={(event) => {
                                    const primaryFont = fontFamily
                                      .split(",")[0]
                                      ?.replace(/['"]/g, "")
                                      .trim();
                                    if (
                                      primaryFont &&
                                      typeof document !== "undefined"
                                    ) {
                                      try {
                                        if (
                                          document.queryCommandSupported?.(
                                            "styleWithCSS",
                                          )
                                        ) {
                                          document.execCommand(
                                            "styleWithCSS",
                                            false,
                                            "true",
                                          );
                                        }
                                        if (
                                          document.queryCommandSupported?.(
                                            "fontName",
                                          )
                                        ) {
                                          document.execCommand(
                                            "fontName",
                                            false,
                                            primaryFont,
                                          );
                                        }
                                      } catch {
                                        // ignore execCommand failures; inline style already enforces font
                                      }
                                    }
                                    event.currentTarget.style.fontFamily =
                                      fontFamily;
                                  }}
                                  onClick={(event) => {
                                    // Allow click position to determine cursor placement
                                    event.stopPropagation();
                                  }}
                                  onBlur={(event) => {
                                    composingGroupsRef.current.delete(group.id);
                                    syncEditorValue(
                                      event.currentTarget,
                                      group.pageIndex,
                                      group.id,
                                      {
                                        skipCaretRestore: true,
                                      },
                                    );
                                    caretOffsetsRef.current.delete(group.id);
                                    editorRefs.current.delete(group.id);
                                    setActiveGroupId(null);
                                    setEditingGroupId(null);
                                  }}
                                  onInput={(event) => {
                                    if (
                                      composingGroupsRef.current.has(group.id)
                                    ) {
                                      return;
                                    }
                                    syncEditorValue(
                                      event.currentTarget,
                                      group.pageIndex,
                                      group.id,
                                    );
                                  }}
                                  style={{
                                    width: "100%",
                                    minHeight: "100%",
                                    height: "auto",
                                    padding: "2px",
                                    backgroundColor: "rgba(255,255,255,0.95)",
                                    color: textColor,
                                    fontSize: `${fontSizePx}px`,
                                    fontFamily,
                                    fontWeight,
                                    fontStyle,
                                    lineHeight: lineHeightRatio,
                                    outline: "none",
                                    border: "none",
                                    display: "block",
                                    whiteSpace,
                                    wordBreak,
                                    overflowWrap,
                                    cursor: "text",
                                    overflow: "visible",
                                  }}
                                >
                                  {group.text || "\u00A0"}
                                </div>,
                                undefined,
                                undefined,
                                selectedGroupIds.has(group.id),
                                groupHandles,
                              )}
                            </Box>
                          );
                        }

                        const textScale = textScales.get(group.id) ?? 1;
                        const shouldScale = autoScaleText && textScale < 0.98;

                        return (
                          <Box key={group.id} style={containerStyle}>
                            {renderGroupContainer(
                              group.id,
                              group.pageIndex,
                              isActive,
                              changed,
                              <div
                                data-text-group={group.id}
                                style={{
                                  width: "100%",
                                  minHeight: "100%",
                                  padding: "2px",
                                  whiteSpace,
                                  wordBreak,
                                  overflowWrap,
                                  fontSize: `${fontSizePx}px`,
                                  fontFamily,
                                  fontWeight,
                                  fontStyle,
                                  lineHeight: lineHeightRatio,
                                  color: textColor,
                                  display: "block",
                                  cursor: "text",
                                  overflow: enableWrap ? "visible" : "hidden",
                                }}
                              >
                                <span
                                  data-text-content
                                  style={{
                                    pointerEvents: "none",
                                    display: enableWrap
                                      ? "inline"
                                      : "inline-block",
                                    transform: shouldScale
                                      ? `scaleX(${textScale})`
                                      : "none",
                                    transformOrigin: "left center",
                                    whiteSpace,
                                    ...legibilityChip,
                                  }}
                                >
                                  {group.text || "\u00A0"}
                                </span>
                              </div>,
                              undefined,
                              (event: React.MouseEvent) => {
                                const shouldActivate =
                                  handleSelectionInteraction(
                                    group.id,
                                    pageGroupIndex,
                                    event,
                                  );
                                if (!shouldActivate) {
                                  setActiveGroupId(null);
                                  setEditingGroupId(null);
                                  return;
                                }

                                const clickX = event.clientX;
                                const clickY = event.clientY;

                                setActiveGroupId(group.id);
                                setEditingGroupId(group.id);
                                caretOffsetsRef.current.delete(group.id);

                                // Log group stats when selected
                                const lines = (group.text ?? "").split("\n");
                                const words = (group.text ?? "")
                                  .split(/\s+/)
                                  .filter((w) => w.length > 0).length;
                                const chars = (group.text ?? "").length;
                                const width =
                                  group.bounds.right - group.bounds.left;
                                const height =
                                  group.bounds.bottom - group.bounds.top;
                                const isMultiLine = lines.length > 1;
                                console.log(
                                  `📝 Selected Text Group "${group.id}":`,
                                );
                                console.log(
                                  `   Lines: ${lines.length}, Words: ${words}, Chars: ${chars}`,
                                );
                                console.log(
                                  `   Dimensions: ${width.toFixed(1)}pt × ${height.toFixed(1)}pt`,
                                );
                                console.log(
                                  `   Type: ${isMultiLine ? "MULTI-LINE (paragraph)" : "SINGLE-LINE"}`,
                                );
                                console.log(
                                  `   Text preview: "${(group.text ?? "").substring(0, 80)}${(group.text ?? "").length > 80 ? "..." : ""}"`,
                                );
                                if (isMultiLine) {
                                  console.log(
                                    `   Line spacing: ${group.lineSpacing?.toFixed(1) ?? "unknown"}pt`,
                                  );
                                }

                                requestAnimationFrame(() => {
                                  const editor =
                                    document.querySelector<HTMLElement>(
                                      `[data-editor-group="${group.id}"]`,
                                    );
                                  if (!editor) return;
                                  editor.focus();

                                  setTimeout(() => {
                                    if (document.caretRangeFromPoint) {
                                      const range =
                                        document.caretRangeFromPoint(
                                          clickX,
                                          clickY,
                                        );
                                      if (range) {
                                        const selection = window.getSelection();
                                        if (selection) {
                                          selection.removeAllRanges();
                                          selection.addRange(range);
                                        }
                                      }
                                    } else if (
                                      (document as any).caretPositionFromPoint
                                    ) {
                                      const pos = (
                                        document as any
                                      ).caretPositionFromPoint(clickX, clickY);
                                      if (pos) {
                                        const range = document.createRange();
                                        range.setStart(
                                          pos.offsetNode,
                                          pos.offset,
                                        );
                                        range.collapse(true);
                                        const selection = window.getSelection();
                                        if (selection) {
                                          selection.removeAllRanges();
                                          selection.addRange(range);
                                        }
                                      }
                                    }
                                  }, 10);
                                });
                              },
                              selectedGroupIds.has(group.id),
                              groupHandles,
                            )}
                          </Box>
                        );
                      })
                    )}
                  </Box>
                </Box>
              </Box>
            </ScrollArea>
          </Card>
        </Stack>
      )}
    </Stack>
  );
};

export default PdfTextEditorView;
