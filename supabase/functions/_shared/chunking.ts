// Deterministic text chunker for DOCUMENTS, used by the embed worker.
//
// Sibling: ./transcript-chunker.ts chunks phone-call transcripts with larger,
// word-based windows. The two were reviewed in the 2026-08-06 audit cleanup
// and kept apart on purpose — see the parameter table at the top of that file
// for why merging them would change retrieval behaviour.
//
// Splits long text into overlapping chunks sized for an embedding model.
// Strategy (in order):
//   1. Split on blank lines (paragraphs).
//   2. If a paragraph is still too large, split on sentence boundaries.
//   3. If a sentence is still too large, hard-split on character window.
// Each emitted chunk carries its char_start/char_end into the original text
// so callers can reconstruct provenance.
//
// Token estimation uses the same Math.ceil(len/4) heuristic the embed worker
// has been using — good enough for budgeting, no tokenizer dependency.

export interface Chunk {
  index:      number;
  text:       string;
  charStart:  number;
  charEnd:    number;
  tokenCount: number;
  // Optional tabular provenance (set by chunkTabularText).
  sheetName?: string;
  rowStart?:  number;
  rowEnd?:    number;
}

export interface ChunkOptions {
  // Target tokens per chunk. text-embedding-3-small handles 8191, but smaller
  // chunks give better recall for RAG. Default ≈ 400 tokens ≈ 1600 chars.
  targetTokens?: number;
  // Overlap between adjacent chunks, in tokens. Default 50 ≈ 200 chars.
  overlapTokens?: number;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(input: string, opts: ChunkOptions = {}): Chunk[] {
  const targetTokens  = opts.targetTokens  ?? 400;
  const overlapTokens = opts.overlapTokens ?? 50;
  const targetChars   = targetTokens  * CHARS_PER_TOKEN;
  const overlapChars  = overlapTokens * CHARS_PER_TOKEN;

  const text = (input ?? "").trim();
  if (!text) return [];

  // Short input → single chunk, no work needed.
  if (text.length <= targetChars) {
    return [{
      index:      0,
      text,
      charStart:  0,
      charEnd:    text.length,
      tokenCount: estimateTokens(text),
    }];
  }

  // Step 1: split into atomic segments (paragraphs → sentences → hard cuts)
  // while remembering each segment's offset into the original text.
  const segments: Array<{ text: string; start: number }> = [];
  const paragraphs = splitWithOffsets(text, /\n\s*\n+/g);
  for (const para of paragraphs) {
    if (para.text.length <= targetChars) {
      segments.push(para);
      continue;
    }
    const sentences = splitWithOffsets(para.text, /(?<=[.!?])\s+/g, para.start);
    for (const sent of sentences) {
      if (sent.text.length <= targetChars) {
        segments.push(sent);
        continue;
      }
      // Last resort: hard window split.
      for (let i = 0; i < sent.text.length; i += targetChars) {
        segments.push({
          text:  sent.text.slice(i, i + targetChars),
          start: sent.start + i,
        });
      }
    }
  }

  // Step 2: greedily pack segments into chunks up to targetChars,
  // adding character-window overlap between adjacent chunks.
  const chunks: Chunk[] = [];
  let buffer     = "";
  let bufferStart = segments[0]?.start ?? 0;
  let bufferEnd   = bufferStart;

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) {
      buffer = "";
      return;
    }
    chunks.push({
      index:      chunks.length,
      text:       trimmed,
      charStart:  bufferStart,
      charEnd:    bufferEnd,
      tokenCount: estimateTokens(trimmed),
    });
    buffer = "";
  };

  for (const seg of segments) {
    // If adding this segment would exceed the budget, flush first.
    if (buffer.length > 0 && buffer.length + 1 + seg.text.length > targetChars) {
      flush();
      // Seed the next buffer with overlap from the just-emitted chunk.
      if (overlapChars > 0 && chunks.length > 0) {
        const last = chunks[chunks.length - 1];
        const tail = last.text.slice(-overlapChars);
        buffer      = tail;
        bufferStart = Math.max(0, last.charEnd - tail.length);
        bufferEnd   = last.charEnd;
      } else {
        bufferStart = seg.start;
        bufferEnd   = seg.start;
      }
    }
    if (buffer.length === 0) {
      bufferStart = seg.start;
    }
    buffer    += (buffer.length > 0 ? "\n" : "") + seg.text;
    bufferEnd  = seg.start + seg.text.length;
  }
  flush();

  return chunks;
}

// Split `text` on `pattern`, returning each piece with its absolute start
// offset (relative to the original input — `baseOffset` lets callers preserve
// nesting offsets when re-splitting a sub-segment).
function splitWithOffsets(
  text:       string,
  pattern:    RegExp,
  baseOffset: number = 0,
): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let cursor = 0;
  // Ensure the regex is global so exec() advances lastIndex.
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const piece = text.slice(cursor, match.index);
    if (piece.trim()) out.push({ text: piece, start: baseOffset + cursor });
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) out.push({ text: tail, start: baseOffset + cursor });
  return out;
}

// ---------------------------------------------------------------------------
// Vertical (key-value) chunking — splits "### Zeile N" blocks (produced by
// gridToMarkdown for wide tables) into chunks that keep complete records
// together. Each chunk includes the "## Sheet:" header for context.
// ---------------------------------------------------------------------------

export function chunkVerticalText(
  input: string,
  opts: { targetTokens?: number } = {},
): Chunk[] {
  const targetTokens = opts.targetTokens ?? 400;
  const targetChars  = targetTokens * CHARS_PER_TOKEN;

  const text = (input ?? "").trim();
  if (!text) return [];

  // Extract "## Sheet:" header (first line).
  const lines = text.split("\n");
  const sheetHeader = lines[0]?.startsWith("## Sheet:") ? lines[0] : "";
  const sheetMatch = sheetHeader.match(/^## Sheet:\s*(.+)/);
  const sheetName  = sheetMatch?.[1]?.trim() ?? undefined;

  // Split on "### Zeile" boundaries into complete record blocks.
  const blocks: string[] = [];
  let current = "";
  for (let i = sheetHeader ? 1 : 0; i < lines.length; i++) {
    if (lines[i].startsWith("### Zeile") && current.trim()) {
      blocks.push(current.trim());
      current = "";
    }
    current += (current ? "\n" : "") + lines[i];
  }
  if (current.trim()) blocks.push(current.trim());

  if (blocks.length === 0) {
    return chunkText(text, { targetTokens, overlapTokens: 50 });
  }

  // Pack blocks into chunks up to targetChars, never splitting a block.
  const chunks: Chunk[] = [];
  let buf = sheetHeader;
  let bufStart = 0;

  const flush = () => {
    const trimmed = buf.trim();
    if (!trimmed || trimmed === sheetHeader.trim()) return;
    chunks.push({
      index:      chunks.length,
      text:       trimmed,
      charStart:  bufStart,
      charEnd:    bufStart + trimmed.length,
      tokenCount: estimateTokens(trimmed),
      sheetName,
    });
  };

  for (const block of blocks) {
    // If adding this block would exceed the budget, flush first.
    if (buf.length + 1 + block.length > targetChars && buf !== sheetHeader) {
      flush();
      buf = sheetHeader;
      bufStart = chunks.length > 0 ? chunks[chunks.length - 1].charEnd : 0;
    }
    buf += "\n\n" + block;
  }
  flush();

  return chunks;
}

// ---------------------------------------------------------------------------
// Tabular chunking — splits Markdown-table text (produced by the xlsx
// extractor) into chunks that preserve column headers in every chunk.
// ---------------------------------------------------------------------------

export interface TabularChunkOptions {
  /** Max data rows per chunk (default 25). */
  rowsPerChunk?: number;
  /** Overlap rows repeated at the start of the next chunk (default 2). */
  overlapRows?: number;
  /** Target tokens per chunk — used as a soft upper bound (default 400). */
  targetTokens?: number;
}

interface SheetSection {
  name: string;
  headerLine: string;
  separatorLine: string;
  dataRows: string[];
  /** Char offset of this section in the original input. */
  startOffset: number;
}

/**
 * Chunk Markdown-table content into self-contained pieces. Each chunk
 * includes the sheet name + repeated column headers so it can be understood
 * independently by an embedding model or LLM.
 *
 * Falls back to `chunkText()` for any section that doesn't look tabular.
 */
export function chunkTabularText(
  input: string,
  opts: TabularChunkOptions = {},
): Chunk[] {
  const rowsPerChunk = opts.rowsPerChunk ?? 25;
  const overlapRows  = opts.overlapRows  ?? 2;
  const targetTokens = opts.targetTokens ?? 400;
  const targetChars  = targetTokens * CHARS_PER_TOKEN;

  const text = (input ?? "").trim();
  if (!text) return [];

  // Split on "## Sheet:" markers while tracking char offsets.
  const sections = splitSheetSections(text);

  if (sections.length === 0) {
    // No tabular markers found — fall back to generic chunking.
    return chunkText(text, { targetTokens, overlapTokens: 50 });
  }

  const chunks: Chunk[] = [];

  for (const section of sections) {
    if (!section.headerLine || section.dataRows.length === 0) {
      // Non-tabular section — use generic chunker.
      const sectionText = buildSectionText(section);
      const sub = chunkText(sectionText, { targetTokens, overlapTokens: 50 });
      for (const c of sub) {
        chunks.push({
          ...c,
          index:     chunks.length,
          charStart: section.startOffset + c.charStart,
          charEnd:   section.startOffset + c.charEnd,
        });
      }
      continue;
    }

    // Adaptive rowsPerChunk: if a single header+row exceeds targetChars,
    // reduce rows per chunk to fit.
    const sampleRowLen = (section.headerLine + "\n" + section.separatorLine + "\n" + (section.dataRows[0] ?? "")).length;
    const effectiveRows = sampleRowLen > targetChars
      ? 1
      : Math.min(rowsPerChunk, Math.max(1, Math.floor(targetChars / Math.max(1, (section.dataRows[0]?.length ?? 50) + 2))));

    const totalRows = section.dataRows.length;
    let rowCursor = 0;

    while (rowCursor < totalRows) {
      const end = Math.min(rowCursor + effectiveRows, totalRows);
      const sliceRows = section.dataRows.slice(rowCursor, end);
      const rowStart = rowCursor + 2; // +2 because row 1 is header in Excel
      const rowEnd   = end + 1;       // inclusive, 1-based

      const chunkLines = [
        `Sheet: ${section.name} (Zeilen ${rowStart}-${rowEnd} von ${totalRows + 1})`,
        section.headerLine,
        section.separatorLine,
        ...sliceRows,
      ];
      const chunkStr = chunkLines.join("\n");

      chunks.push({
        index:      chunks.length,
        text:       chunkStr,
        charStart:  section.startOffset,
        charEnd:    section.startOffset + chunkStr.length,
        tokenCount: estimateTokens(chunkStr),
        sheetName:  section.name,
        rowStart,
        rowEnd,
      });

      // Advance cursor with overlap.
      const prev = rowCursor;
      rowCursor = end - overlapRows;
      if (rowCursor <= prev) rowCursor = end; // prevent infinite loop
    }
  }

  return chunks;
}

// Parse the "## Sheet:" delimited input into sections.
function splitSheetSections(text: string): SheetSection[] {
  const sections: SheetSection[] = [];
  // Split on "## Sheet:" keeping the delimiter.
  const parts = text.split(/(?=^## Sheet:)/m);

  let offset = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) { offset += part.length; continue; }

    const lines = trimmed.split("\n");
    const titleLine = lines[0] ?? "";
    const nameMatch = titleLine.match(/^## Sheet:\s*(.+)/);
    const name = nameMatch?.[1]?.trim() ?? "Unknown";

    // Find the Markdown table header (first line starting with |) and separator.
    let headerLine = "";
    let separatorLine = "";
    const dataRows: string[] = [];
    let foundHeader = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!foundHeader && line.startsWith("|")) {
        headerLine = line;
        // Next line should be the separator (| --- | --- |).
        if (i + 1 < lines.length && /^\|[\s-|]+\|$/.test(lines[i + 1])) {
          separatorLine = lines[i + 1];
          i++; // skip separator
        }
        foundHeader = true;
        continue;
      }
      if (foundHeader && line.startsWith("|")) {
        dataRows.push(line);
      }
    }

    sections.push({
      name,
      headerLine,
      separatorLine,
      dataRows,
      startOffset: offset,
    });

    offset += part.length;
  }

  return sections;
}

function buildSectionText(section: SheetSection): string {
  const lines = [`## Sheet: ${section.name}`];
  if (section.headerLine) lines.push(section.headerLine);
  if (section.separatorLine) lines.push(section.separatorLine);
  lines.push(...section.dataRows);
  return lines.join("\n");
}
