// Word-based chunker for phone-call TRANSCRIPTS.
//
// NOT a duplicate of ./chunking.ts — the two split different content with
// different parameters, and merging them would change retrieval behaviour of
// the production pipeline. Checked during the 2026-08-06 audit cleanup and
// deliberately kept separate:
//
//                    this file (transcripts)   chunking.ts (documents)
//   consumer         phone-assistant-call-     worker-embed
//                    complete
//   unit             words                     characters (token estimate)
//   chunk size       500 words (~650 tokens)   400 tokens (1600 chars)
//   overlap          50 words (~10 %)          50 tokens (200 chars, ~3 %)
//   segmentation     sentences only            paragraphs -> sentences ->
//                                              hard window
//   variants         —                         + chunkTabularText,
//                                              chunkVerticalText for
//                                              spreadsheet-shaped sources
//
// The larger, sentence-only windows are what a spoken transcript needs: it
// has no paragraphs, no tables and no headings, and a caller's question and
// its answer routinely sit several sentences apart. Documents are the
// opposite case — structure to exploit, and smaller windows measurably
// improve recall. Unifying the two would mean re-chunking and re-embedding
// every existing source, so retrieval quality wins over tidiness here.
//
// Mirrors apps/web/src/lib/content/chunker.ts, which chunks manually uploaded
// text/PDF/audio sources in the web app with the same parameters.

export type TranscriptChunk = {
  chunkIndex: number;
  chunkText: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
};

const CHUNK_SIZE = 500; // target words per chunk
const OVERLAP = 50; // words overlap between chunks

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitIntoChunks(text: string): TranscriptChunk[] {
  if (!text.trim()) return [];

  const sentences = splitSentences(text);
  const chunks: TranscriptChunk[] = [];
  let currentWords: string[] = [];
  let chunkIndex = 0;
  let charPos = 0;
  let chunkStartChar = 0;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    currentWords.push(...words);
    charPos += sentence.length + 1;

    if (countWords(currentWords.join(" ")) >= CHUNK_SIZE) {
      const chunkText = currentWords.join(" ");
      chunks.push({
        chunkIndex,
        chunkText,
        charStart: chunkStartChar,
        charEnd: chunkStartChar + chunkText.length,
        tokenCount: Math.ceil(chunkText.length / 4),
      });
      chunkIndex++;

      const overlapWords = currentWords.slice(-OVERLAP);
      chunkStartChar =
        chunkStartChar + chunkText.length - overlapWords.join(" ").length;
      currentWords = overlapWords;
    }
  }

  if (currentWords.length > 0) {
    const chunkText = currentWords.join(" ");
    chunks.push({
      chunkIndex,
      chunkText,
      charStart: chunkStartChar,
      charEnd: chunkStartChar + chunkText.length,
      tokenCount: Math.ceil(chunkText.length / 4),
    });
  }

  return chunks;
}

export { countWords };
