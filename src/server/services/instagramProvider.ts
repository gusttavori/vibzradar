/**
 * Radar Vibz - Instagram Provider Interface & Implementations
 * Roteamento Híbrido: Meta Graph API (Própria Conta) + Apify (Terceiros)
 */

import { Profile, Publication, IntegrationMethod } from '../../types/radar';

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  permalink: string;
  timestamp: string;
}

export interface InstagramProvider {
  name: IntegrationMethod;
  testConnection(config: { accessToken: string; pageId: string; apiVersion: string }): Promise<{
    success: boolean;
    message: string;
    accountDetails?: Record<string, unknown>;
  }>;
  fetchProfilePosts(
    profile: Profile,
    config: { accessToken: string; pageId: string; apiVersion: string }
  ): Promise<{
    success: boolean;
    posts: Omit<Publication, 'id' | 'detectedAt'>[];
    error?: string;
  }>;
}

export class MetaInstagramProvider implements InstagramProvider {
  public name: IntegrationMethod = 'meta_graph_api';

  private resolveToken(configToken?: string): string {
    const envToken = (process.env.META_ACCESS_TOKEN || '').trim();
    const cleanConfigToken = (configToken || '').trim();

    if (envToken && !/[•●*]/.test(envToken) && envToken.length > 20) {
      return envToken;
    }

    if (cleanConfigToken && !/[•●*]/.test(cleanConfigToken) && cleanConfigToken.length > 20) {
      return cleanConfigToken;
    }

    return '';
  }

  async testConnection(config: { accessToken: string; pageId: string; apiVersion: string }): Promise<{
    success: boolean;
    message: string;
    accountDetails?: Record<string, unknown>;
  }> {
    const token = this.resolveToken(config.accessToken);
    const pageId = (config.pageId && !/[•●*]/.test(config.pageId) && config.pageId.trim().length > 0)
      ? config.pageId.trim()
      : (process.env.META_PAGE_ID || '').trim();

    const apiVersion = config.apiVersion || 'v21.0';

    if (!token || !pageId) {
      return {
        success: false,
        message: 'Credenciais ausentes. Forneça o Access Token e o Page ID no .env ou nas Configurações.'
      };
    }

    try {
      const url = `https://graph.facebook.com/${apiVersion}/${pageId}?fields=id,name,username&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'RadarVibz-Client/1.0' } });
      const data = await res.json();

      if (!res.ok || data.error) {
        return {
          success: false,
          message: data.error?.message ? `Meta API (${data.error.code}): ${data.error.message}` : 'Falha ao autenticar na Meta Graph API.'
        };
      }

      const accountLabel = data.username ? `@${data.username}` : (data.name || data.id);
      return {
        success: true,
        message: `Conexão bem-sucedida! Conta Conectada: ${accountLabel}`,
        accountDetails: data
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Erro de rede ao conectar.'
      };
    }
  }

  async fetchProfilePosts(
    profile: Profile,
    config: { accessToken: string; pageId: string; apiVersion: string }
  ): Promise<{
    success: boolean;
    posts: Omit<Publication, 'id' | 'detectedAt'>[];
    error?: string;
  }> {
    const token = this.resolveToken(config.accessToken);
    const pageId = (config.pageId && !/[•●*]/.test(config.pageId) && config.pageId.trim().length > 0)
      ? config.pageId.trim()
      : (process.env.META_PAGE_ID || '').trim();

    const apiVersion = config.apiVersion || 'v21.0';
    const cleanUsername = profile.username.replace(/^@/, '').trim();

    if (!token || !pageId) {
      return {
        success: false,
        posts: [],
        error: 'Meta Access Token ou Page ID não encontrados no .env.'
      };
    }

    try {
      // 1. Identifica se é a própria conta
      let authenticatedUsername = '';
      try {
        const meRes = await fetch(`https://graph.facebook.com/${apiVersion}/${pageId}?fields=username&access_token=${encodeURIComponent(token)}`);
        const meData = await meRes.json();
        authenticatedUsername = (meData.username || '').toLowerCase();
      } catch (_) {}

      const isOwnAccount = authenticatedUsername && (cleanUsername.toLowerCase() === authenticatedUsername || cleanUsername.toLowerCase() === 'vibzeventos');
      let mediaList: InstagramMediaItem[] = [];

      if (isOwnAccount) {
        // ROTA A: Leitura direta da própria conta (Meta Graph API Oficial)
        const ownUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=25&access_token=${encodeURIComponent(token)}`;
        const res = await fetch(ownUrl);
        const data = await res.json();

        if (!res.ok || data.error) {
          console.error(`❌ [Meta API - Própria Conta @${cleanUsername}]:`, data.error);
          return { success: false, posts: [], error: data.error?.message };
        }
        mediaList = data.data || [];
        console.log(`✅ [Meta API - Própria Conta] @${cleanUsername}: ${mediaList.length} mídias obtidas via /{ig_user}/media.`);
      } else {
        // ROTA B: Leitura de contas de terceiros via Apify Instagram Post Scraper
        const apifyToken = process.env.APIFY_TOKEN || '';
        
        if (!apifyToken) {
          console.error(`❌ [Apify] Token ausente para buscar terceiros (@${cleanUsername}). Adicione APIFY_TOKEN no .env.`);
          return { success: false, posts: [], error: 'APIFY_TOKEN não configurada no .env para buscar perfis de terceiros.' };
        }

        // Endpoint síncrono da Apify para extrair posts por username
        const runUrl = `https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items?token=${apifyToken}`;
        
        const payload = {
          username: [cleanUsername],
          resultsLimit: 15
        };

        const res = await fetch(runUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`❌ [Apify Error - @${cleanUsername}]:`, errText);
          return { success: false, posts: [], error: `Erro Apify HTTP ${res.status}` };
        }

        const items = await res.json();
        
        if (!Array.isArray(items)) {
          return { success: false, posts: [], error: 'Formato de resposta inválido da Apify.' };
        }

        mediaList = items.map((item: any) => ({
          id: item.id || item.shortCode || `apify_${Date.now()}_${Math.random()}`,
          caption: item.caption || '',
          media_type: item.type === 'Video' ? 'VIDEO' : item.type === 'Sidecar' ? 'CAROUSEL_ALBUM' : 'IMAGE',
          media_url: item.displayUrl || item.videoUrl || '',
          permalink: item.url || `https://instagram.com/p/${item.shortCode}/`,
          timestamp: item.timestamp || new Date().toISOString()
        }));

        console.log(`✅ [Apify - Terceiros] @${cleanUsername}: ${mediaList.length} mídias obtidas com sucesso.`);
      }

      // Mapeamento final para o banco PostgreSQL
      const posts: Omit<Publication, 'id' | 'detectedAt'>[] = mediaList.map(item => ({
        profileId: profile.id,
        username: profile.username,
        externalId: item.id,
        originalUrl: item.permalink,
        mediaType: item.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL_ALBUM' : item.media_type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        caption: item.caption || '',
        publishedAt: item.timestamp,
        mediaUrl: item.media_url,
        thumbnailUrl: item.media_url,
        analysisStatus: 'pending',
        relevance: 'none',
        isReviewed: false,
        isDemo: false
      }));

      return { success: true, posts };
    } catch (err: unknown) {
      console.error(`❌ [Exception em @${cleanUsername}]:`, err);
      return {
        success: false,
        posts: [],
        error: err instanceof Error ? err.message : 'Falha na requisição.'
      };
    }
  }
}

export class DemoSimulationProvider implements InstagramProvider {
  public name: IntegrationMethod = 'demo_simulation';

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: 'Modo de Demonstração pronto. Simula publicações fictícias no Sudoeste Baiano.'
    };
  }

  async fetchProfilePosts(profile: Profile): Promise<{
    success: boolean;
    posts: Omit<Publication, 'id' | 'detectedAt'>[];
    error?: string;
  }> {
    const now = new Date();
    const cleanUser = profile.username.replace(/^@/, '');
    const posts: Omit<Publication, 'id' | 'detectedAt'>[] = [];

    const templates: Record<string, { caption: string; type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' }[]> = {
      'Casa de eventos': [
        {
          caption: `GRANDIOSO FESTIVAL DE FIM DE ANO 2026! 🎆 No dia 19 de Dezembro de 2026, a ${profile.displayName} recebe o mega show com grandes nomes da música baiana. Ingressos antecipados disponíveis em breve no Vibz. Garanta sua presença em ${profile.city}!`,
          type: 'IMAGE'
        }
      ],
      'Bar': [
        {
          caption: `QUINTA ACÚSTICA no ${profile.displayName}! Nesta quinta tem voz e violão a partir das 19h30. Reservas pelo direct.`,
          type: 'IMAGE'
        }
      ]
    };

    const chosenList = templates[profile.category] || templates['Bar'];
    const chosen = chosenList[Math.floor(Math.random() * chosenList.length)];
    const simId = `sim_${cleanUser}_${Date.now()}`;

    posts.push({
      profileId: profile.id,
      username: profile.username,
      externalId: simId,
      originalUrl: `https://instagram.com/p/${simId}`,
      mediaType: chosen.type,
      caption: chosen.caption,
      publishedAt: now.toISOString(),
      mediaUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop',
      thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop',
      analysisStatus: 'pending',
      relevance: 'none',
      isReviewed: false,
      isDemo: true
    });

    return {
      success: true,
      posts
    };
  }
}