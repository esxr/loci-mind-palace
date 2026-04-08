// POST /npc-chat — Streams NPC dialogue via SSE, grounded in concept source material.
// Deno runtime edge function for Supabase.

import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/supabase.ts';
import type {
  NPCChatRequest,
  ChatMessage,
  PalaceConfig,
  ConceptGraph,
  Concept,
  Relationship,
} from '../_shared/types.ts';

// ─── Rate Limiting (in-memory, per-isolate) ───

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateBucket>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitMap.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count++;
  return bucket.count > RATE_LIMIT_MAX;
}

// Periodic cleanup to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitMap) {
    if (now >= bucket.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

// ─── Helpers ───

function errorResponse(
  status: number,
  code: string,
  description: string,
): Response {
  return new Response(
    JSON.stringify({ error: { code, description } }),
    {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    },
  );
}

function getClientIP(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function findConceptById(graph: ConceptGraph, conceptId: string): Concept | undefined {
  return graph.concepts.find((c) => c.id === conceptId);
}

function getNeighborConcepts(graph: ConceptGraph, conceptId: string): Concept[] {
  const neighborIds = new Set<string>();

  for (const rel of graph.relationships) {
    if (rel.source_id === conceptId) {
      neighborIds.add(rel.target_id);
    } else if (rel.target_id === conceptId) {
      neighborIds.add(rel.source_id);
    }
  }

  return graph.concepts.filter((c) => neighborIds.has(c.id));
}

function buildSystemPrompt(
  concept: Concept,
  neighbors: Concept[],
): string {
  const neighborList = neighbors
    .map((n) => `- ${n.name}: ${n.description}`)
    .join('\n');

  const sourceExcerpts = concept.source_notes.length > 0
    ? concept.source_notes.join('\n')
    : '(No source notes available)';

  return `You are ${concept.name}, a guide in a mind palace \u2014 a 3D world built from study notes.

You represent the concept: ${concept.description}

Related concepts nearby:
${neighborList || '(None)'}

Source material you are grounded in:
---
${sourceExcerpts}
---

Rules:
- Speak in first person as if you ARE this concept personified.
- Help the user understand the concept through conversation.
- Reference related concepts and suggest the user visit their spaces.
- Keep responses concise (2-4 sentences) unless the user asks for detail.
- Stay grounded in the source material. Do not invent facts not present in the notes.
- Be friendly, engaging, and slightly theatrical \u2014 you are a character in a palace.`;
}

function buildClaudeMessages(
  conversationHistory: ChatMessage[],
  userMessage: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// ─── Conversation Persistence ───

async function persistConversation(
  palaceId: string,
  conceptId: string,
  messages: ChatMessage[],
  newUserMessage: string,
  assistantResponse: string,
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: newUserMessage },
      { role: 'assistant', content: assistantResponse },
    ];

    // Upsert: unique constraint on (palace_id, concept_id)
    await supabase
      .from('conversations')
      .upsert(
        {
          palace_id: palaceId,
          concept_id: conceptId,
          messages: updatedMessages,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'palace_id,concept_id' },
      );
  } catch {
    // Non-critical — log but don't fail the request
    console.error('Failed to persist conversation:', palaceId, conceptId);
  }
}

// ─── Main Handler ───

Deno.serve(async (req: Request) => {
  // 1. CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only accept POST
  if (req.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST is accepted');
  }

  // 2. Rate limiting
  const clientIP = getClientIP(req);
  if (isRateLimited(clientIP)) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many chat requests. Limit: 30 per minute.');
  }

  // 3. Parse and validate request
  let body: NPCChatRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  const { palace_id, concept_id, message, conversation_history = [] } = body;

  if (!palace_id || !concept_id || !message) {
    return errorResponse(
      400,
      'INVALID_REQUEST',
      'Missing required fields: palace_id, concept_id, and message are required.',
    );
  }

  // 4. Load palace config from Supabase
  const supabase = getSupabaseClient();

  const { data: palace, error: palaceError } = await supabase
    .from('palaces')
    .select('palace_config, concept_graph')
    .eq('id', palace_id)
    .single();

  if (palaceError || !palace) {
    return errorResponse(404, 'PALACE_NOT_FOUND', `Palace not found: ${palace_id}`);
  }

  // Palace config contains the full concept graph; fall back to concept_graph column
  const conceptGraph: ConceptGraph =
    palace.palace_config?.concept_graph ?? palace.concept_graph;

  if (!conceptGraph?.concepts) {
    return errorResponse(404, 'PALACE_NOT_FOUND', 'Palace has no concept graph.');
  }

  // 5. Extract concept and neighbors
  const concept = findConceptById(conceptGraph, concept_id);
  if (!concept) {
    return errorResponse(
      404,
      'CONCEPT_NOT_FOUND',
      `Concept "${concept_id}" not found in palace graph.`,
    );
  }

  const neighbors = getNeighborConcepts(conceptGraph, concept_id);

  // 6. Build system prompt and messages
  const systemPrompt = buildSystemPrompt(concept, neighbors);
  const claudeMessages = buildClaudeMessages(conversation_history, message);

  // 7. Stream Claude Haiku response via SSE
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    return errorResponse(500, 'SERVER_ERROR', 'Anthropic API key not configured.');
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 10_000);

  let claudeResponse: Response;
  try {
    claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-20250414',
        max_tokens: 512,
        temperature: 0.7,
        stream: true,
        system: systemPrompt,
        messages: claudeMessages,
      }),
      signal: abortController.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') {
      return errorResponse(504, 'TIMEOUT', 'No response from Claude within 10 seconds.');
    }
    return errorResponse(502, 'UPSTREAM_ERROR', 'Failed to connect to Claude API.');
  }

  if (!claudeResponse.ok) {
    clearTimeout(timeoutId);
    const errText = await claudeResponse.text().catch(() => 'unknown');
    console.error('Claude API error:', claudeResponse.status, errText);
    return errorResponse(502, 'UPSTREAM_ERROR', `Claude API returned ${claudeResponse.status}.`);
  }

  if (!claudeResponse.body) {
    clearTimeout(timeoutId);
    return errorResponse(502, 'UPSTREAM_ERROR', 'Claude API returned no body.');
  }

  // 8. Transform Claude SSE stream into our SSE format
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let fullText = '';

  const stream = new ReadableStream({
    async start(controller) {
      const reader = claudeResponse.body!.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines from buffer
          const lines = buffer.split('\n');
          // Keep last potentially-incomplete line in buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              // Claude SSE event types:
              // - content_block_delta with delta.type === "text_delta"
              // - message_stop
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta'
              ) {
                const text = event.delta.text;
                fullText += text;
                const chunk = `data: ${JSON.stringify({ type: 'chunk', text })}\n\n`;
                controller.enqueue(encoder.encode(chunk));
              }
            } catch {
              // Skip non-JSON or unrecognized lines
            }
          }
        }

        // Flush any remaining buffer
        if (buffer.startsWith('data: ') && buffer.length > 6) {
          const data = buffer.slice(6).trim();
          if (data && data !== '[DONE]') {
            try {
              const event = JSON.parse(data);
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta'
              ) {
                const text = event.delta.text;
                fullText += text;
                const chunk = `data: ${JSON.stringify({ type: 'chunk', text })}\n\n`;
                controller.enqueue(encoder.encode(chunk));
              }
            } catch {
              // Ignore
            }
          }
        }

        // Send done event with full assembled text
        const doneEvent = `data: ${JSON.stringify({ type: 'done', full_text: fullText })}\n\n`;
        controller.enqueue(encoder.encode(doneEvent));
        controller.close();

        // Persist conversation asynchronously (fire-and-forget)
        persistConversation(
          palace_id,
          concept_id,
          conversation_history,
          message,
          fullText,
        );
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          const timeoutEvent = `data: ${JSON.stringify({
            type: 'error',
            error: { code: 'TIMEOUT', description: 'Stream timed out.' },
          })}\n\n`;
          controller.enqueue(encoder.encode(timeoutEvent));
        } else {
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: { code: 'STREAM_ERROR', description: 'Stream interrupted.' },
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        }
        controller.close();
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
      }
    },
    cancel() {
      clearTimeout(timeoutId);
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders,
    },
  });
});
