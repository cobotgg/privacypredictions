import OpenAI from 'openai';
import { config } from '../config/env.js';
import { getTrendingMarkets, getMarket } from './dflow.js';
import type { Market, AIAnalysis } from '../types/index.js';

let openai: OpenAI | null = null;

// Initialize OpenAI client
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    openai = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openai;
}

// Check if AI is available
export function isAIAvailable(): boolean {
  return !!config.openaiApiKey;
}

// Analyze a market using AI
export async function analyzeMarket(marketId: string): Promise<AIAnalysis> {
  const client = getOpenAI();
  const market = await getMarket(marketId);

  if (!market) {
    throw new Error(`Market not found: ${marketId}`);
  }

  const prompt = `Analyze this prediction market and provide a trading recommendation:

Market: ${market.title}
Current YES Price: ${market.yesPrice}%
Current NO Price: ${market.noPrice}%
Status: ${market.status}
${market.description ? `Description: ${market.description}` : ''}

Provide your analysis in the following JSON format:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "reasoning": "Brief explanation of your analysis",
  "suggestedSide": "yes" | "no" | null,
  "suggestedAmount": number | null
}

Consider:
1. The current pricing and implied probability
2. Any obvious mispricings
3. Market sentiment indicators
4. Risk/reward ratio`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a prediction market analyst. Provide objective, data-driven analysis. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '{}';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return {
      marketId,
      sentiment: analysis.sentiment || 'neutral',
      confidence: analysis.confidence || 50,
      reasoning: analysis.reasoning || 'No analysis available',
      suggestedSide: analysis.suggestedSide,
      suggestedAmount: analysis.suggestedAmount,
    };
  } catch (error: any) {
    console.error('AI analysis error:', error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

// Get AI trade suggestions
export async function getSuggestions(): Promise<AIAnalysis[]> {
  const client = getOpenAI();
  const markets = await getTrendingMarkets(5);

  const suggestions: AIAnalysis[] = [];

  for (const market of markets) {
    try {
      const analysis = await analyzeMarket(market.id);
      if (analysis.suggestedSide && analysis.confidence >= 60) {
        suggestions.push(analysis);
      }
    } catch (error) {
      // Skip markets that fail analysis
      continue;
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

// Research a specific market - answer user questions
export async function researchMarket(
  marketId: string,
  question: string,
  marketContext?: { title: string; yesPrice: number; noPrice: number; volume?: number }
): Promise<{ response: string; marketId: string }> {
  const client = getOpenAI();

  // Get market details if not provided
  let context = marketContext;
  if (!context) {
    const market = await getMarket(marketId);
    if (market) {
      context = {
        title: market.title,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume: market.volume24h,
      };
    }
  }

  const prompt = `You are a prediction market research analyst. A user is asking about a specific market.

MARKET INFORMATION:
- Title: ${context?.title || marketId}
- Current YES Price: ${context?.yesPrice || 'Unknown'}% (implied probability)
- Current NO Price: ${context?.noPrice || 'Unknown'}%
${context?.volume ? `- 24h Volume: $${context.volume.toLocaleString()}` : ''}

USER QUESTION: "${question}"

Provide a helpful, informative response. Be objective and balanced. Consider:
1. What the current prices imply about market expectations
2. Potential risks and uncertainties
3. Factors that could affect the outcome
4. Whether the market seems fairly priced

Important: This is research only, not financial advice. Always remind users to do their own research.

Respond in a conversational but professional tone. Keep the response focused and under 300 words.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a knowledgeable prediction market analyst. Provide balanced, objective analysis. Never give specific trading instructions or financial advice.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 600,
    });

    const content = response.choices[0]?.message?.content || 'Unable to analyze this market at the moment.';

    return {
      response: content,
      marketId,
    };
  } catch (error: any) {
    console.error('Research error:', error.message);
    throw new Error(`Research failed: ${error.message}`);
  }
}

// Natural language trade command
export async function executeNaturalLanguageCommand(
  command: string
): Promise<{
  action: 'buy' | 'sell' | 'analyze' | 'unknown';
  marketId?: string;
  side?: 'yes' | 'no';
  amount?: number;
  reasoning?: string;
}> {
  const client = getOpenAI();

  const markets = await getTrendingMarkets(10);
  const marketList = markets
    .map(m => `- ${m.id}: ${m.title} (YES: ${m.yesPrice}%, NO: ${m.noPrice}%)`)
    .join('\n');

  const prompt = `Parse this trading command and return a structured response:

User command: "${command}"

Available markets:
${marketList}

Return JSON in this format:
{
  "action": "buy" | "sell" | "analyze" | "unknown",
  "marketId": "market ticker or null",
  "side": "yes" | "no" | null,
  "amount": number in USD or null,
  "reasoning": "explanation of parsed command"
}

Examples:
- "Buy $50 of yes on Bitcoin" -> {"action": "buy", "marketId": "KXBTC...", "side": "yes", "amount": 50, "reasoning": "..."}
- "What do you think about the election?" -> {"action": "analyze", "marketId": "KXELECTION...", "reasoning": "..."}
- "Sell my Trump position" -> {"action": "sell", "marketId": "KXTRUMP...", "reasoning": "..."}`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a trading assistant. Parse natural language commands into structured trading actions. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || '{}';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { action: 'unknown', reasoning: 'Could not parse command' };
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error: any) {
    console.error('NL command error:', error.message);
    return { action: 'unknown', reasoning: `Error: ${error.message}` };
  }
}
