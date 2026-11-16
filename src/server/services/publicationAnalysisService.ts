/**
 * Radar Vibz - PublicationAnalysisService
 * Análise de publicações com Google Gemini API (@google/genai) + Fallback Heurístico Avançado
 */

import { GoogleGenAI, Type } from '@google/genai';
import { AIAnalysisResult } from '../../types/radar';
import { db } from '../database';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PublicationAnalysisService {
  private ai: GoogleGenAI | null = null;
  private cache: Map<string, AIAnalysisResult> = new Map();

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        this.ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      } catch (err) {
        console.warn('Could not initialize GoogleGenAI client:', err);
      }
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  async analyzePublication(params: {
    caption: string;
    username: string;
    category?: string;
    city?: string;
    publishedAt: string;
    bypassCache?: boolean;
  }): Promise<AIAnalysisResult> {
    const safeCaption = (params.caption || '').trim();
    const cacheKey = `${params.username}:${safeCaption}`;
    if (!params.bypassCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    if (!safeCaption || safeCaption.length < 5) {
      const emptyResult: AIAnalysisResult = {
        is_event: false,
        is_opportunity: false,
        category: 'Outros',
        relevance: 'low',
        event_name: null,
        event_date: null,
        event_time: null,
        venue: null,
        city: params.city || null,
        state: 'BA',
        artists: [],
        organizer: params.username,
        summary: 'Publicação sem legenda descritiva ou curta demais para análise.',
        commercial_opportunity: 'Sem oportunidade identificável.',
        suggested_action: 'Manter arquivado.',
        confidence: 0.95,
        missing_information: [],
      };
      this.cache.set(cacheKey, emptyResult);
      return emptyResult;
    }

    const settings = await db.getSettings();

    if (this.ai && settings.gemini.enabled) {
      const prompt = `Analise a seguinte publicação de entretenimento do Instagram para o Radar Vibz (ferramenta de inteligência comercial do Vibz Eventos no Sudoeste da Bahia).
Identifique se anuncia um evento, show, festa, festival, gravação de audiovisual com público, abertura de vendas, virada de lote ou programação musical, e avalie a oportunidade comercial para o Vibz (divulgação, venda de ingressos, cobertura ou parcerias).

REGRAS DE CLASSIFICAÇÃO:
1. IGNORE publicações puramente de rotina diária, cardápios de almoço, agradecimentos pós-evento ("que noite linda foi", "obrigado a todos que foram", "tbt") ou notas técnicas.
2. NUNCA assuma que a data de publicação é a data do evento. Extraia a data em que o evento ocorrerá (ex: "18 de novembro", "sexta-feira 13", "amanhã" relativo à data de postagem ${params.publishedAt}). Se não houver data explícita, retorne null.
3. NUNCA invente atrações, locais ou horários que não estejam no texto.
4. Classificação de Relevância (seja proativo para detectar oportunidades comerciais):
   - "high": show, festival, festa, gravação de audiovisual aberta ao público, anúncio de atrações, abertura de vendas, virada de lote, promoção relâmpago de ingressos, divulgação de setores/pontos de venda.
   - "medium": programação semanal de bar/casa de shows, música ao vivo, "hoje tem", "é amanhã", prévia de evento sem detalhes completos.
   - "low": posts institucionais sem evento, cardápios, retrospectivas pós-evento.
5. Sempre que relevance for "high" ou "medium", defina is_event: true e is_opportunity: true.

DADOS DA PUBLICAÇÃO:
- Perfil: @${params.username}
- Categoria do perfil: ${params.category || 'Não informada'}
- Cidade base: ${params.city || 'Vitória da Conquista, BA'}
- Data de postagem: ${params.publishedAt}
- Legenda original:
"""
${safeCaption}
"""`;

      const primaryModel = settings.gemini.model || 'gemini-2.5-flash';
      const modelsToTry = Array.from(new Set([primaryModel, 'gemini-2.5-flash', 'gemini-2.0-flash']));

      for (const modelName of modelsToTry) {
        try {
          const response = await this.ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              temperature: settings.gemini.temperature ?? 0.2,
              systemInstruction:
                'Você é o motor de inteligência comercial do Radar Vibz, especializado em detectar shows, festas, aberturas de vendas e eventos musicais na Bahia.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  is_event: { type: Type.BOOLEAN },
                  is_opportunity: { type: Type.BOOLEAN },
                  category: { type: Type.STRING },
                  relevance: { type: Type.STRING },
                  event_name: { type: Type.STRING, nullable: true },
                  event_date: { type: Type.STRING, nullable: true },
                  event_time: { type: Type.STRING, nullable: true },
                  venue: { type: Type.STRING, nullable: true },
                  city: { type: Type.STRING, nullable: true },
                  state: { type: Type.STRING, nullable: true },
                  artists: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  organizer: { type: Type.STRING, nullable: true },
                  summary: { type: Type.STRING },
                  commercial_opportunity: { type: Type.STRING },
                  suggested_action: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  missing_information: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: [
                  'is_event',
                  'is_opportunity',
                  'category',
                  'relevance',
                  'summary',
                  'commercial_opportunity',
                  'suggested_action',
                  'confidence',
                  'missing_information',
                ],
              },
            },
          });

          const textOutput = response.text;
          if (textOutput) {
            const parsed = JSON.parse(textOutput) as AIAnalysisResult;
            const rel = (parsed.relevance || '').toLowerCase();
            parsed.relevance = rel === 'high' ? 'high' : rel === 'medium' ? 'medium' : 'low';
            if (parsed.relevance === 'high' || parsed.relevance === 'medium') {
              parsed.is_event = true;
              parsed.is_opportunity = true;
            }
            this.cache.set(cacheKey, parsed);
            return parsed;
          }
        } catch (err: any) {
          const status = err?.status || err?.code;
          console.warn(`[Gemini Warning] Falha com modelo "${modelName}" (status ${status || 'N/A'}):`, err?.message || err);
          if (status === 503 || status === 429) {
            await sleep(1500);
          }
        }
      }

      console.warn('Gemini API indisponível após retentativas, acionando motor heurístico.');
    }

    const fallback = this.heuristicAnalysis({ ...params, caption: safeCaption });
    this.cache.set(cacheKey, fallback);
    return fallback;
  }

  public heuristicAnalysis(params: {
    caption: string;
    username: string;
    category?: string;
    city?: string;
    publishedAt: string;
  }): AIAnalysisResult {
    const text = params.caption.toLowerCase();

    const isRetrospective =
      text.includes('obrigado a todos') ||
      text.includes('que energia linda foi') ||
      text.includes('edição passada') ||
      text.includes('tbt') ||
      text.includes('manutenção preventiva') ||
      text.includes('almoço executivo') ||
      text.includes('cardápio') ||
      text.includes('prato do dia');

    if (isRetrospective) {
      return {
        is_event: false,
        is_opportunity: false,
        category: 'Retrospectiva / Institucional',
        relevance: 'low',
        event_name: null,
        event_date: null,
        event_time: null,
        venue: null,
        city: params.city || 'Vitória da Conquista',
        state: 'BA',
        artists: [],
        organizer: params.username,
        summary: 'Publicação de registro pós-evento, cardápio ou comunicado interno sem chamada de evento futuro.',
        commercial_opportunity: 'Nenhuma oportunidade imediata identificada.',
        suggested_action: 'Manter em histórico sem contato comercial.',
        confidence: 0.9,
        missing_information: [],
      };
    }

    // Sinais fortes de venda de ingressos, shows e grandes eventos
    const highCommercialKeywords = [
      'ingresso',
      'ingressos',
      'lote',
      'virada de lote',
      'abertura de vendas',
      'promoção relâmpago',
      'meu bilhete',
      'bilheteria',
      'pontos de venda',
      'setores',
      'camarote',
      'frontstage',
      'festival',
      'micareta',
      'show do',
      'show de',
      'confirmado',
      'confirmados',
      'gravação do audiovisual',
      'audiovisual',
    ];

    // Sinais médios de festas, casas de show e programação local
    const mediumEventKeywords = [
      'show',
      'festa',
      'arrocha',
      'revoada',
      'baile',
      'calourada',
      'save the date',
      'atração',
      'atrações',
      'palco',
      'ao vivo',
      'acústico',
      'voz e violão',
      'sextou',
      'hoje tem',
      'é hoje',
      'é amanhã',
      'amanhã',
      'evento',
      'turnê',
    ];

    const isHigh = highCommercialKeywords.some((kw) => text.includes(kw));
    const isMedium = mediumEventKeywords.some((kw) => text.includes(kw));

    let eventDate: string | null = null;
    const dateRegex =
      /(\d{1,2})[\/\s]+(?:de\s+)?(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\d{1,2})/i;
    const match = text.match(dateRegex);
    if (match) {
      const day = match[1].padStart(2, '0');
      const monthStr = match[2].toLowerCase();
      const monthMap: Record<string, string> = {
        janeiro: '01',
        fevereiro: '02',
        março: '03',
        abril: '04',
        maio: '05',
        junho: '06',
        julho: '07',
        agosto: '08',
        setembro: '09',
        outubro: '10',
        novembro: '11',
        dezembro: '12',
      };
      const month = monthMap[monthStr] || match[2].padStart(2, '0');
      const currentYear = new Date().getFullYear();
      eventDate = `${currentYear}-${month}-${day}`;
    }

    let eventTime: string | null = null;
    const timeMatch = text.match(/(\d{1,2})h(?:\d{2})?|às (\d{1,2}:\d{2})/);
    if (timeMatch) {
      eventTime = timeMatch[1] ? `${timeMatch[1].padStart(2, '0')}:00` : timeMatch[2];
    }

    const firstLine = params.caption
      .split('\n')[0]
      .replace(/[^\p{L}\p{N}\s\-:!.,&@]/gu, '')
      .trim();
    const eventName =
      firstLine.length >= 5 && firstLine.length <= 65
        ? firstLine
        : `Evento / Programação @${params.username}`;

    if (isHigh) {
      return {
        is_event: true,
        is_opportunity: true,
        category: text.includes('festival') ? 'Festival' : 'Show / Evento',
        relevance: 'high',
        event_name: eventName,
        event_date: eventDate,
        event_time: eventTime || '21:00',
        venue: 'Local a confirmar',
        city: params.city || 'Vitória da Conquista',
        state: 'BA',
        artists: [],
        organizer: params.username,
        summary: `Divulgação comercial ativa de evento/ingressos identificada em @${params.username}.`,
        commercial_opportunity:
          'Alta prioridade: evento com venda de ingressos ou campanha ativa. Propor parceria de divulgação e cobertura oficial Vibz.',
        suggested_action: 'Entrar em contato com a produção via WhatsApp ou Direct imediatamente.',
        confidence: 0.89,
        missing_information: eventDate ? [] : ['Data exata do evento'],
      };
    }

    if (isMedium) {
      return {
        is_event: true,
        is_opportunity: true,
        category: text.includes('bar') || text.includes('acústico') ? 'Programação de bar' : 'Festa / Show',
        relevance: 'medium',
        event_name: eventName,
        event_date: eventDate,
        event_time: eventTime || '20:00',
        venue: params.username,
        city: params.city || 'Vitória da Conquista',
        state: 'BA',
        artists: [],
        organizer: params.username,
        summary: `Anúncio de show, festa ou programação musical identificado no perfil @${params.username}.`,
        commercial_opportunity:
          'Oportunidade comercial para divulgação na agenda do Vibz e abordagem de parceria.',
        suggested_action: 'Cadastrar evento no Vibz e contatar organizador.',
        confidence: 0.85,
        missing_information: [],
      };
    }

    return {
      is_event: false,
      is_opportunity: false,
      category: 'Outros',
      relevance: 'low',
      event_name: null,
      event_date: null,
      event_time: null,
      venue: null,
      city: params.city || 'Vitória da Conquista',
      state: 'BA',
      artists: [],
      organizer: params.username,
      summary: 'Publicação de rotina ou sem chamada direta para evento futuro.',
      commercial_opportunity: 'Sem oportunidade comercial identificada.',
      suggested_action: 'Nenhuma ação necessária.',
      confidence: 0.85,
      missing_information: [],
    };
  }
}

export const aiAnalysisService = new PublicationAnalysisService();