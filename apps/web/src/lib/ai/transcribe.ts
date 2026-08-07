// Whisper API transcription — graceful: returns empty string if no key

function getOpenAIKey(): string | undefined {
  return process.env.OPENAI_RESEARCH_TIMEKEEPER_KEY ?? process.env.OPENAI_API_KEY;
}

export async function transcribeAudio(
  file: File,
  language: string = "de",
): Promise<string> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error("OpenAI API Key fehlt");

  const { OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language,
    response_format: "text",
  });

  return typeof response === "string" ? response : String(response);
}
